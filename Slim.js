console.log('SlimJS v2.2.4')

class Slim extends HTMLElement {

    static tag(tag, clazz) {
        Slim.__prototypeDict[tag] = clazz
        document.registerElement(tag, clazz)
    }

    static plugin(phase, plugin) {
        if (phase !== 'create' && phase !== 'beforeRender' && phase !== 'afterRender' && phase !== 'beforeDestroy') {
            throw "Supported phase can be create, beforeDestroy, beforeRender or afterRender only"
        }
        Slim.__plugins[phase].push(plugin)
    }

    static __runPlugins(phase, element) {
        Slim.__plugins[phase].forEach( fn => {
            fn(element)
        })
    }

    static __moveChildren(source, target, activate) {
        while (source.children.length) {
            target.appendChild(source.children[0])
        }
        let children = Array.prototype.slice.call( target.querySelectorAll('*'))
        for (let child of children) {
            if (activate && child.isSlim) {
                child.createdCallback(true)
            }
        }
    }

    static __lookup(obj, desc) {
        var arr = desc.split(".");
        var prop = arr[0]
        while(arr.length && obj) {
            obj = obj[prop = arr.shift()]
        }
        return {source: desc, prop:prop, obj:obj};
    }

    static __createRepeater(descriptor) {
        var repeater
        if (Slim.__isWCSupported) {
            repeater = document.createElement('slim-repeat')
            repeater.sourceNode = descriptor.target
            descriptor.target.parentNode.insertBefore(repeater, descriptor.target)
            descriptor.repeater = repeater
        } else {
            descriptor.target.insertAdjacentHTML('beforebegin', '<slim-repeat slim-new="true"></slim-repeat>')
            repeater = descriptor.target.parentNode.querySelector('slim-repeat[slim-new="true"]')
            repeater.__proto__ = window.SlimRepeater.prototype
            repeater.sourceNode = descriptor.target
            repeater.removeAttribute('slim-new')

            repeater.createdCallback()
        }
        repeater._boundParent = descriptor.source
        descriptor.target.parentNode.removeChild(descriptor.target)
        repeater.setAttribute('source', descriptor.properties[0])
        descriptor.repeater = repeater
    }

    static __dashToCamel(dash) {
        return dash.indexOf('-') < 0 ? dash : dash.replace(/-[a-z]/g, m => {return m[1].toUpperCase()})
    }

    static __camelToDash(camel) {
        return camel.replace(/([A-Z])/g, '-$1').toLowerCase();
    }

    find(selector) {
        return this.querySelector(selector)
    }

    findAll(selector) {
        return Array.prototype.slice.call(this.querySelectorAll(selector))
    }

    watch(prop, executor) {
        let descriptor = {
            type: 'W',
            properties: [ prop ],
            executor: executor,
            target: this,
            source: this
        }
        this._bindings = this._bindings || {}
        this._boundParent = this._boundParent || this
        this.__bind(descriptor)
    }

    callAttribute(attributeName, value) {
        let fnName = this.getAttribute(attributeName)
        if (fnName === null) return
        if (typeof this[fnName] === 'function') {
            this[fnName](value)
        } else if (typeof this._boundParent[fnName] === 'function') {
            this._boundParent[fnName](value)
        } else if (this._boundParent && this._boundParent._boundParent && typeof this._boundParent._boundParent[fnName] === 'function') {
            // safari, firefox
            this._boundParent._boundParent[fnName](value)
        }
    }

    __bind(descriptor) {
        descriptor.properties.forEach(
            prop => {
                let rootProp
                if (prop.indexOf('.') > 0) {
                    rootProp = prop.split('.')[0]
                } else {
                    rootProp = prop
                }
                let source = descriptor.target._boundParent
                source._bindings[rootProp] = source._bindings[rootProp] || {
                        value: source[rootProp],
                        executors: []
                    }
                if (!source.__lookupGetter__(prop)) source.__defineGetter__(prop, function() {
                    return this._bindings[prop].value
                })
                if (!source.__lookupSetter__(prop)) source.__defineSetter__(prop, function(x) {
                    this._bindings[prop].value = x
                    if (descriptor.sourceText) {
                        descriptor.target.innerText = descriptor.sourceText
                    }
                    this._executeBindings()
                })
                let executor
                if (descriptor.type === 'P') {
                    executor = () => {
                        let value = Slim.__lookup(source, prop).obj
                        descriptor.target[ Slim.__dashToCamel(descriptor.attribute) ] = value
                        descriptor.target.setAttribute( descriptor.attribute, value )
                    }
                } else if (descriptor.type === 'M') {
                    executor = () => {
                        let value = source[ descriptor.method ].apply( source,
                            descriptor.properties.map( prop => { return source[prop] }))
                        descriptor.target[ Slim.__dashToCamel(descriptor.attribute) ] = value
                        descriptor.target.setAttribute( descriptor.attribute, value )
                    }
                } else if (descriptor.type === 'T') {
                    executor = () => {
                        let source = descriptor.target._boundParent
                        descriptor.target.innerText = descriptor.target.innerText.replace(`[[${prop}]]`, Slim.__lookup(source, prop).obj)
                    }
                } else if (descriptor.type === 'R') {
                    executor = () => {
                        descriptor.repeater.renderList()
                    }
                } else if (descriptor.type === 'W') {
                    executor = () => {
                        descriptor.executor(Slim.__lookup(source, prop).obj)
                    }
                }
                source._bindings[rootProp].executors.push( executor )
            }
        )
    }

    static __processRepeater(attribute, child) {
        return {
            type: 'R',
            target: child,
            attribute: attribute.nodeName,
            properties: [ attribute.nodeValue ],
            source: child._boundParent
        }
    }

    static __processAttribute(attribute, child) {
        if (attribute.nodeName === 'slim-repeat') {
            return Slim.__processRepeater(attribute, child)
        }

        const rxInject = /\{(.+[^(\((.+)\))])\}/.exec(attribute.nodeValue)
        const rxProp = /\[\[(.+[^(\((.+)\))])\]\]/.exec(attribute.nodeValue)
        const rxMethod = /\[\[(.+)(\((.+)\)){1}\]\]/.exec(attribute.nodeValue)

        if (rxMethod) {
            return {
                type: 'M',
                target: child,
                attribute: attribute.nodeName,
                method: rxMethod[1],
                properties: rxMethod[3].replace(' ','').split(',')
            }
        } else if (rxProp) {
            return {
                type: 'P',
                target: child,
                attribute: attribute.nodeName,
                properties: [ rxProp[1] ]
            }
        } else if (rxInject) {
            return {
                type: 'I',
                target: child,
                attribute: attribute.nodeName,
                factory: rxInject[1]
            }
        }
    }

    get isVirtual() {
        let node = this
        while (node) {
            node = node.parentNode
            if (!node) {
                return true
            }
            if (node.nodeName === 'BODY') {
                return false
            }
        }
        return true
    }

    createdCallback(force = false) {
        this.initialize()
        if (this.isVirtual && !force) return
        if (!this.__onCreatedComplete) this.onBeforeCreated()
        this._captureBindings()
        Slim.__runPlugins('create', this)
        if (!this.__onCreatedComplete) this.onCreated()
        this.__onCreatedComplete = true
        this.onBeforeRender()
        Slim.__runPlugins('beforeRender', this)
        Slim.__moveChildren( this._virtualDOM, this, true )
        this.onAfterRender()
        Slim.__runPlugins('afterRender', this)
        this.update()
    }

    detachedCallback() {
        Slim.__runPlugins('beforeDestroy', this)
        this.onDestroy()
    }

    initialize(forceNewVirtualDOM = false) {
        this._bindings = this._bindings || {}
        this._boundChildren = this._boundChildren || []
        this.alternateTemplate = this.alternateTemplate || null
        if (forceNewVirtualDOM) {
            this._virtualDOM = document.createElement('slim-root')
        }
        this._virtualDOM = this._virtualDOM || document.createElement('slim-root')
    }

    get isSlim() { return true }
    get template() { return null }

    onDestroy() { /* abstract */ }
    onBeforeCreated() { /* abstract */ }
    onCreated() { /* abstract */}
    onBeforeRender() { /* abstract */ }
    onAfterRender() { /* abstract */ }
    update() {
        this._executeBindings()
    }

    render(template) {
        Slim.__runPlugins('beforeRender', this)
        this.onBeforeRender()
        this.alternateTemplate = template
        this.initialize(true)
        this.innerHTML = ''
        this._captureBindings()
        Slim.__moveChildren( this._virtualDOM, this, true )
        this._executeBindings()
        this.onAfterRender()
        Slim.__runPlugins('afterRender', this)
    }


    _executeBindings() {
        this._boundChildren.forEach( child => {
            // this._boundChildren.forEach( child => {
            if (child.hasAttribute('bind') && child.sourceText !== undefined) {
                child.innerText = child.sourceText
            }
        })
        Object.keys(this._bindings).forEach( property => {
            this._bindings[property].executors.forEach( fn => { fn() } )
        })
    }

    _captureBindings() {
        let $tpl = this.alternateTemplate || this.template
        if (!$tpl) {
            while (this.children.length) {
                this._virtualDOM.appendChild( this.children[0] )
            }
        } else if (typeof($tpl) === 'string') {
            this._virtualDOM.innerHTML = $tpl
            let virtualContent = this._virtualDOM.querySelector('content')
            if (virtualContent) {
                while (this.children.length) {
                    virtualContent.appendChild( this.children[0] )
                }
            }
        }

        let allChildren = Array.prototype.slice.call( this._virtualDOM.querySelectorAll('*') )
        for (let child of allChildren) {
            if (child === this._virtualDOM) {
                alert('fuck')
            }
            child._boundParent = child._boundParent || this
            this._boundChildren.push(child)
            if (child.getAttribute('slim-id')) {
                child._boundParent[ Slim.__dashToCamel(child.getAttribute('slim-id')) ] = child
            }
            let slimID = child.getAttribute('slim-id')
            if (slimID) this[slimID] = child
            let descriptors = []
            if (child.attributes) for (let i = 0; i < child.attributes.length; i++) {
                let desc = Slim.__processAttribute(child.attributes[i], child)
                if (desc) descriptors.push(desc)
                if (child.attributes[i].nodeName.indexOf('#') == '0') {
                    let refName = child.attributes[i].nodeName.slice(1)
                    this[refName] = child
                }
            }

            descriptors = descriptors.sort( (a) => {
                if (a.type === 'I') { return -1 }
                else if (a.type === 'R') return 1
                return 0
            })

            descriptors.forEach(
                descriptor => {
                    if (descriptor.type === 'P' || descriptor.type === 'M') {
                        this.__bind(descriptor)
                    } else if (descriptor.type === 'I') {
                        Slim.__inject(descriptor)
                    } else if (descriptor.type === 'R') {
                        Slim.__createRepeater(descriptor)
                        this.__bind(descriptor)
                    }
                }
            )
        }

        allChildren = Array.prototype.slice.call( this._virtualDOM.querySelectorAll('*[bind]'))

        for (let child of allChildren) {
            let match = child.innerText.match(/\[\[([\w|.]+)\]\]/g)
            if (match) {
                let properties = []
                for (let i = 0; i < match.length; i++) {
                    let lookup = match[i].match(/([^\[].+[^\]])/)[0]
                    properties.push(lookup)
                }
                let descriptor = {
                    type: 'T',
                    properties: properties,
                    target: child,
                    sourceText: child.innerText
                }
                child.sourceText = child.innerText
                this.__bind(descriptor)
            }
        }
    }

}

Slim.__prototypeDict = {}
Slim.__plugins = {
    'create': [],
    'beforeRender': [],
    'afterRender': [],
    'beforeDestroy': []
}

try {
    Slim.__isWCSupported = (function() {
        return ('registerElement' in document
        && 'import' in document.createElement('link')
        && 'content' in document.createElement('template'))
    })()
}
catch (err) {
    Slim.__isWCSupported = false
}

class SlimRepeater extends Slim {
    get sourceData() {
        try {
            let lookup = Slim.__lookup(this._boundParent, this.getAttribute('source'))
            return lookup.obj || [] //this._boundParent[ this.getAttribute('source') ]
        }
        catch (err) {
            return []
        }
    }

    get isVirtual() {
        return false
    }

    renderList() {
        if (!this.sourceNode) return
        this.clones = []
        this.innerHTML = ''

        this.sourceData.forEach( (dataItem, index) => {
            let clone = this.sourceNode.cloneNode(true)
            clone.removeAttribute('slim-repeat')
            clone.setAttribute('slim-repeat-index', index)
            if (!Slim.__isWCSupported) {
                this.insertAdjacentHTML('beforeEnd', clone.outerHTML)
                clone = this.find('*[slim-repeat-index="' + index.toString() + '"]')
            }
            clone.data = dataItem
            clone.data_index = index
            clone.data_source = this.sourceData
            clone.sourceText = clone.innerText
            if (Slim.__isWCSupported) {
                this.insertAdjacentElement('beforeEnd', clone)
            }
            this.clones.push(clone)
        })
        this._captureBindings()
        for (let clone of this.clones) {
            clone.data = clone.data
            if (Slim.__prototypeDict[clone.localName] !== undefined || clone.isSlim) {
                clone._boundParent = this._boundParent
            }
            else {
                clone._boundParent = clone
            }
            Array.prototype.slice.call(clone.querySelectorAll('*')).forEach( element => {
                element._boundParent = clone._boundParent
                element.data = clone.data
                element.data_index = clone.data_index
                element.data_source = clone.data_source
            })
        }

        this._executeBindings()
        Slim.__moveChildren(this._virtualDOM, this, true)
    }
}
Slim.tag('slim-repeat', SlimRepeater)
window.SlimRepeater = SlimRepeater
window.Slim = Slim

if (typeof module !== 'undefined' && module.exports) {
    module.exports.Slim = Slim
    module.exports.SlimRepeater = SlimRepeater
}