/* http://mozilla.github.io/brick/download.html */
define('brick', [], function() {});
// We don't use the platform bootstrapper, so fake this stuff.

window.Platform = {};
var logFlags = {};



// DOMTokenList polyfill fir IE9
(function () {

if (typeof window.Element === "undefined" || "classList" in document.documentElement) return;

var prototype = Array.prototype,
    indexOf = prototype.indexOf,
    slice = prototype.slice,
    push = prototype.push,
    splice = prototype.splice,
    join = prototype.join;

function DOMTokenList(el) {
  this._element = el;
  if (el.className != this._classCache) {
    this._classCache = el.className;

    if (!this._classCache) return;

      // The className needs to be trimmed and split on whitespace
      // to retrieve a list of classes.
      var classes = this._classCache.replace(/^\s+|\s+$/g,'').split(/\s+/),
        i;
    for (i = 0; i < classes.length; i++) {
      push.call(this, classes[i]);
    }
  }
};

function setToClassName(el, classes) {
  el.className = classes.join(' ');
}

DOMTokenList.prototype = {
  add: function(token) {
    if(this.contains(token)) return;
    push.call(this, token);
    setToClassName(this._element, slice.call(this, 0));
  },
  contains: function(token) {
    return indexOf.call(this, token) !== -1;
  },
  item: function(index) {
    return this[index] || null;
  },
  remove: function(token) {
    var i = indexOf.call(this, token);
     if (i === -1) {
       return;
     }
    splice.call(this, i, 1);
    setToClassName(this._element, slice.call(this, 0));
  },
  toString: function() {
    return join.call(this, ' ');
  },
  toggle: function(token) {
    if (indexOf.call(this, token) === -1) {
      this.add(token);
    } else {
      this.remove(token);
    }
  }
};

window.DOMTokenList = DOMTokenList;

function defineElementGetter (obj, prop, getter) {
  if (Object.defineProperty) {
    Object.defineProperty(obj, prop,{
      get : getter
    })
  } else {
    obj.__defineGetter__(prop, getter);
  }
}

defineElementGetter(Element.prototype, 'classList', function () {
  return new DOMTokenList(this);
});

})();


/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

// SideTable is a weak map where possible. If WeakMap is not available the
// association is stored as an expando property.
var SideTable;
// TODO(arv): WeakMap does not allow for Node etc to be keys in Firefox
if (typeof WeakMap !== 'undefined' && navigator.userAgent.indexOf('Firefox/') < 0) {
  SideTable = WeakMap;
} else {
  (function() {
    var defineProperty = Object.defineProperty;
    var counter = Date.now() % 1e9;

    SideTable = function() {
      this.name = '__st' + (Math.random() * 1e9 >>> 0) + (counter++ + '__');
    };

    SideTable.prototype = {
      set: function(key, value) {
        var entry = key[this.name];
        if (entry && entry[0] === key)
          entry[1] = value;
        else
          defineProperty(key, this.name, {value: [key, value], writable: true});
      },
      get: function(key) {
        var entry;
        return (entry = key[this.name]) && entry[0] === key ?
            entry[1] : undefined;
      },
      delete: function(key) {
        this.set(key, undefined);
      }
    }
  })();
}

/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(global) {

  var registrationsTable = new SideTable();

  // We use setImmediate or postMessage for our future callback.
  var setImmediate = window.msSetImmediate;

  // Use post message to emulate setImmediate.
  if (!setImmediate) {
    var setImmediateQueue = [];
    var sentinel = String(Math.random());
    window.addEventListener('message', function(e) {
      if (e.data === sentinel) {
        var queue = setImmediateQueue;
        setImmediateQueue = [];
        queue.forEach(function(func) {
          func();
        });
      }
    });
    setImmediate = function(func) {
      setImmediateQueue.push(func);
      window.postMessage(sentinel, '*');
    };
  }

  // This is used to ensure that we never schedule 2 callas to setImmediate
  var isScheduled = false;

  // Keep track of observers that needs to be notified next time.
  var scheduledObservers = [];

  /**
   * Schedules |dispatchCallback| to be called in the future.
   * @param {MutationObserver} observer
   */
  function scheduleCallback(observer) {
    scheduledObservers.push(observer);
    if (!isScheduled) {
      isScheduled = true;
      setImmediate(dispatchCallbacks);
    }
  }

  function wrapIfNeeded(node) {
    return window.ShadowDOMPolyfill &&
        window.ShadowDOMPolyfill.wrapIfNeeded(node) ||
        node;
  }

  function dispatchCallbacks() {
    // http://dom.spec.whatwg.org/#mutation-observers

    isScheduled = false; // Used to allow a new setImmediate call above.

    var observers = scheduledObservers;
    scheduledObservers = [];
    // Sort observers based on their creation UID (incremental).
    observers.sort(function(o1, o2) {
      return o1.uid_ - o2.uid_;
    });

    var anyNonEmpty = false;
    observers.forEach(function(observer) {

      // 2.1, 2.2
      var queue = observer.takeRecords();
      // 2.3. Remove all transient registered observers whose observer is mo.
      removeTransientObserversFor(observer);

      // 2.4
      if (queue.length) {
        observer.callback_(queue, observer);
        anyNonEmpty = true;
      }
    });

    // 3.
    if (anyNonEmpty)
      dispatchCallbacks();
  }

  function removeTransientObserversFor(observer) {
    observer.nodes_.forEach(function(node) {
      var registrations = registrationsTable.get(node);
      if (!registrations)
        return;
      registrations.forEach(function(registration) {
        if (registration.observer === observer)
          registration.removeTransientObservers();
      });
    });
  }

  /**
   * This function is used for the "For each registered observer observer (with
   * observer's options as options) in target's list of registered observers,
   * run these substeps:" and the "For each ancestor ancestor of target, and for
   * each registered observer observer (with options options) in ancestor's list
   * of registered observers, run these substeps:" part of the algorithms. The
   * |options.subtree| is checked to ensure that the callback is called
   * correctly.
   *
   * @param {Node} target
   * @param {function(MutationObserverInit):MutationRecord} callback
   */
  function forEachAncestorAndObserverEnqueueRecord(target, callback) {
    for (var node = target; node; node = node.parentNode) {
      var registrations = registrationsTable.get(node);

      if (registrations) {
        for (var j = 0; j < registrations.length; j++) {
          var registration = registrations[j];
          var options = registration.options;

          // Only target ignores subtree.
          if (node !== target && !options.subtree)
            continue;

          var record = callback(options);
          if (record)
            registration.enqueue(record);
        }
      }
    }
  }

  var uidCounter = 0;

  /**
   * The class that maps to the DOM MutationObserver interface.
   * @param {Function} callback.
   * @constructor
   */
  function JsMutationObserver(callback) {
    this.callback_ = callback;
    this.nodes_ = [];
    this.records_ = [];
    this.uid_ = ++uidCounter;
  }

  JsMutationObserver.prototype = {
    observe: function(target, options) {
      target = wrapIfNeeded(target);

      // 1.1
      if (!options.childList && !options.attributes && !options.characterData ||

          // 1.2
          options.attributeOldValue && !options.attributes ||

          // 1.3
          options.attributeFilter && options.attributeFilter.length &&
              !options.attributes ||

          // 1.4
          options.characterDataOldValue && !options.characterData) {

        throw new SyntaxError();
      }

      var registrations = registrationsTable.get(target);
      if (!registrations)
        registrationsTable.set(target, registrations = []);

      // 2
      // If target's list of registered observers already includes a registered
      // observer associated with the context object, replace that registered
      // observer's options with options.
      var registration;
      for (var i = 0; i < registrations.length; i++) {
        if (registrations[i].observer === this) {
          registration = registrations[i];
          registration.removeListeners();
          registration.options = options;
          break;
        }
      }

      // 3.
      // Otherwise, add a new registered observer to target's list of registered
      // observers with the context object as the observer and options as the
      // options, and add target to context object's list of nodes on which it
      // is registered.
      if (!registration) {
        registration = new Registration(this, target, options);
        registrations.push(registration);
        this.nodes_.push(target);
      }

      registration.addListeners();
    },

    disconnect: function() {
      this.nodes_.forEach(function(node) {
        var registrations = registrationsTable.get(node);
        for (var i = 0; i < registrations.length; i++) {
          var registration = registrations[i];
          if (registration.observer === this) {
            registration.removeListeners();
            registrations.splice(i, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }, this);
      this.records_ = [];
    },

    takeRecords: function() {
      var copyOfRecords = this.records_;
      this.records_ = [];
      return copyOfRecords;
    }
  };

  /**
   * @param {string} type
   * @param {Node} target
   * @constructor
   */
  function MutationRecord(type, target) {
    this.type = type;
    this.target = target;
    this.addedNodes = [];
    this.removedNodes = [];
    this.previousSibling = null;
    this.nextSibling = null;
    this.attributeName = null;
    this.attributeNamespace = null;
    this.oldValue = null;
  }

  function copyMutationRecord(original) {
    var record = new MutationRecord(original.type, original.target);
    record.addedNodes = original.addedNodes.slice();
    record.removedNodes = original.removedNodes.slice();
    record.previousSibling = original.previousSibling;
    record.nextSibling = original.nextSibling;
    record.attributeName = original.attributeName;
    record.attributeNamespace = original.attributeNamespace;
    record.oldValue = original.oldValue;
    return record;
  };

  // We keep track of the two (possibly one) records used in a single mutation.
  var currentRecord, recordWithOldValue;

  /**
   * Creates a record without |oldValue| and caches it as |currentRecord| for
   * later use.
   * @param {string} oldValue
   * @return {MutationRecord}
   */
  function getRecord(type, target) {
    return currentRecord = new MutationRecord(type, target);
  }

  /**
   * Gets or creates a record with |oldValue| based in the |currentRecord|
   * @param {string} oldValue
   * @return {MutationRecord}
   */
  function getRecordWithOldValue(oldValue) {
    if (recordWithOldValue)
      return recordWithOldValue;
    recordWithOldValue = copyMutationRecord(currentRecord);
    recordWithOldValue.oldValue = oldValue;
    return recordWithOldValue;
  }

  function clearRecords() {
    currentRecord = recordWithOldValue = undefined;
  }

  /**
   * @param {MutationRecord} record
   * @return {boolean} Whether the record represents a record from the current
   * mutation event.
   */
  function recordRepresentsCurrentMutation(record) {
    return record === recordWithOldValue || record === currentRecord;
  }

  /**
   * Selects which record, if any, to replace the last record in the queue.
   * This returns |null| if no record should be replaced.
   *
   * @param {MutationRecord} lastRecord
   * @param {MutationRecord} newRecord
   * @param {MutationRecord}
   */
  function selectRecord(lastRecord, newRecord) {
    if (lastRecord === newRecord)
      return lastRecord;

    // Check if the the record we are adding represents the same record. If
    // so, we keep the one with the oldValue in it.
    if (recordWithOldValue && recordRepresentsCurrentMutation(lastRecord))
      return recordWithOldValue;

    return null;
  }

  /**
   * Class used to represent a registered observer.
   * @param {MutationObserver} observer
   * @param {Node} target
   * @param {MutationObserverInit} options
   * @constructor
   */
  function Registration(observer, target, options) {
    this.observer = observer;
    this.target = target;
    this.options = options;
    this.transientObservedNodes = [];
  }

  Registration.prototype = {
    enqueue: function(record) {
      var records = this.observer.records_;
      var length = records.length;

      // There are cases where we replace the last record with the new record.
      // For example if the record represents the same mutation we need to use
      // the one with the oldValue. If we get same record (this can happen as we
      // walk up the tree) we ignore the new record.
      if (records.length > 0) {
        var lastRecord = records[length - 1];
        var recordToReplaceLast = selectRecord(lastRecord, record);
        if (recordToReplaceLast) {
          records[length - 1] = recordToReplaceLast;
          return;
        }
      } else {
        scheduleCallback(this.observer);
      }

      records[length] = record;
    },

    addListeners: function() {
      this.addListeners_(this.target);
    },

    addListeners_: function(node) {
      var options = this.options;
      if (options.attributes)
        node.addEventListener('DOMAttrModified', this, true);

      if (options.characterData)
        node.addEventListener('DOMCharacterDataModified', this, true);

      if (options.childList)
        node.addEventListener('DOMNodeInserted', this, true);

      if (options.childList || options.subtree)
        node.addEventListener('DOMNodeRemoved', this, true);
    },

    removeListeners: function() {
      this.removeListeners_(this.target);
    },

    removeListeners_: function(node) {
      var options = this.options;
      if (options.attributes)
        node.removeEventListener('DOMAttrModified', this, true);

      if (options.characterData)
        node.removeEventListener('DOMCharacterDataModified', this, true);

      if (options.childList)
        node.removeEventListener('DOMNodeInserted', this, true);

      if (options.childList || options.subtree)
        node.removeEventListener('DOMNodeRemoved', this, true);
    },

    /**
     * Adds a transient observer on node. The transient observer gets removed
     * next time we deliver the change records.
     * @param {Node} node
     */
    addTransientObserver: function(node) {
      // Don't add transient observers on the target itself. We already have all
      // the required listeners set up on the target.
      if (node === this.target)
        return;

      this.addListeners_(node);
      this.transientObservedNodes.push(node);
      var registrations = registrationsTable.get(node);
      if (!registrations)
        registrationsTable.set(node, registrations = []);

      // We know that registrations does not contain this because we already
      // checked if node === this.target.
      registrations.push(this);
    },

    removeTransientObservers: function() {
      var transientObservedNodes = this.transientObservedNodes;
      this.transientObservedNodes = [];

      transientObservedNodes.forEach(function(node) {
        // Transient observers are never added to the target.
        this.removeListeners_(node);

        var registrations = registrationsTable.get(node);
        for (var i = 0; i < registrations.length; i++) {
          if (registrations[i] === this) {
            registrations.splice(i, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }, this);
    },

    handleEvent: function(e) {
      // Stop propagation since we are managing the propagation manually.
      // This means that other mutation events on the page will not work
      // correctly but that is by design.
      e.stopImmediatePropagation();

      switch (e.type) {
        case 'DOMAttrModified':
          // http://dom.spec.whatwg.org/#concept-mo-queue-attributes

          var name = e.attrName;
          var namespace = e.relatedNode.namespaceURI;
          var target = e.target;

          // 1.
          var record = new getRecord('attributes', target);
          record.attributeName = name;
          record.attributeNamespace = namespace;

          // 2.
          var oldValue =
              e.attrChange === MutationEvent.ADDITION ? null : e.prevValue;

          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 3.1, 4.2
            if (!options.attributes)
              return;

            // 3.2, 4.3
            if (options.attributeFilter && options.attributeFilter.length &&
                options.attributeFilter.indexOf(name) === -1 &&
                options.attributeFilter.indexOf(namespace) === -1) {
              return;
            }
            // 3.3, 4.4
            if (options.attributeOldValue)
              return getRecordWithOldValue(oldValue);

            // 3.4, 4.5
            return record;
          });

          break;

        case 'DOMCharacterDataModified':
          // http://dom.spec.whatwg.org/#concept-mo-queue-characterdata
          var target = e.target;

          // 1.
          var record = getRecord('characterData', target);

          // 2.
          var oldValue = e.prevValue;


          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 3.1, 4.2
            if (!options.characterData)
              return;

            // 3.2, 4.3
            if (options.characterDataOldValue)
              return getRecordWithOldValue(oldValue);

            // 3.3, 4.4
            return record;
          });

          break;

        case 'DOMNodeRemoved':
          this.addTransientObserver(e.target);
          // Fall through.
        case 'DOMNodeInserted':
          // http://dom.spec.whatwg.org/#concept-mo-queue-childlist
          var target = e.relatedNode;
          var changedNode = e.target;
          var addedNodes, removedNodes;
          if (e.type === 'DOMNodeInserted') {
            addedNodes = [changedNode];
            removedNodes = [];
          } else {

            addedNodes = [];
            removedNodes = [changedNode];
          }
          var previousSibling = changedNode.previousSibling;
          var nextSibling = changedNode.nextSibling;

          // 1.
          var record = getRecord('childList', target);
          record.addedNodes = addedNodes;
          record.removedNodes = removedNodes;
          record.previousSibling = previousSibling;
          record.nextSibling = nextSibling;

          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 2.1, 3.2
            if (!options.childList)
              return;

            // 2.2, 3.3
            return record;
          });

      }

      clearRecords();
    }
  };

  global.JsMutationObserver = JsMutationObserver;

})(this);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

if (!window.MutationObserver) {
  window.MutationObserver =
      window.WebKitMutationObserver ||
      window.JsMutationObserver;
  if (!MutationObserver) {
    throw new Error("no mutation observer support");
  }
}

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

/**
 * Implements `document.register`
 * @module CustomElements
*/

/**
 * Polyfilled extensions to the `document` object.
 * @class Document
*/

(function(scope) {

// imports

if (!scope) {
  scope = window.CustomElements = {flags:{}};
}
var flags = scope.flags;

// native document.register?

var hasNative = Boolean(document.register);
var useNative = !flags.register && hasNative;

if (useNative) {

  // stub
  var nop = function() {};

  // exports
  scope.registry = {};
  scope.upgradeElement = nop;

  scope.watchShadow = nop;
  scope.upgrade = nop;
  scope.upgradeAll = nop;
  scope.upgradeSubtree = nop;
  scope.observeDocument = nop;
  scope.upgradeDocument = nop;
  scope.takeRecords = nop;

} else {

  /**
   * Registers a custom tag name with the document.
   *
   * When a registered element is created, a `readyCallback` method is called
   * in the scope of the element. The `readyCallback` method can be specified on
   * either `options.prototype` or `options.lifecycle` with the latter taking
   * precedence.
   *
   * @method register
   * @param {String} name The tag name to register. Must include a dash ('-'),
   *    for example 'x-component'.
   * @param {Object} options
   *    @param {String} [options.extends]
   *      (_off spec_) Tag name of an element to extend (or blank for a new
   *      element). This parameter is not part of the specification, but instead
   *      is a hint for the polyfill because the extendee is difficult to infer.
   *      Remember that the input prototype must chain to the extended element's
   *      prototype (or HTMLElement.prototype) regardless of the value of
   *      `extends`.
   *    @param {Object} options.prototype The prototype to use for the new
   *      element. The prototype must inherit from HTMLElement.
   *    @param {Object} [options.lifecycle]
   *      Callbacks that fire at important phases in the life of the custom
   *      element.
   *
   * @example
   *      FancyButton = document.register("fancy-button", {
   *        extends: 'button',
   *        prototype: Object.create(HTMLButtonElement.prototype, {
   *          readyCallback: {
   *            value: function() {
   *              console.log("a fancy-button was created",
   *            }
   *          }
   *        })
   *      });
   * @return {Function} Constructor for the newly registered type.
   */
  function register(name, options) {
    //console.warn('document.register("' + name + '", ', options, ')');
    // construct a defintion out of options
    // TODO(sjmiles): probably should clone options instead of mutating it
    var definition = options || {};
    if (!name) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('document.register: first argument `name` must not be empty');
    }
    if (name.indexOf('-') < 0) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('document.register: first argument (\'name\') must contain a dash (\'-\'). Argument provided was \'' + String(name) + '\'.');
    }
    // record name
    definition.name = name;
    // must have a prototype, default to an extension of HTMLElement
    // TODO(sjmiles): probably should throw if no prototype, check spec
    if (!definition.prototype) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('Options missing required prototype property');
    }
    // ensure a lifecycle object so we don't have to null test it
    definition.lifecycle = definition.lifecycle || {};
    // build a list of ancestral custom elements (for native base detection)
    // TODO(sjmiles): we used to need to store this, but current code only
    // uses it in 'resolveTagName': it should probably be inlined
    definition.ancestry = ancestry(definition.extends);
    // extensions of native specializations of HTMLElement require localName
    // to remain native, and use secondary 'is' specifier for extension type
    resolveTagName(definition);
    // some platforms require modifications to the user-supplied prototype
    // chain
    resolvePrototypeChain(definition);
    // overrides to implement attributeChanged callback
    overrideAttributeApi(definition.prototype);
    // 7.1.5: Register the DEFINITION with DOCUMENT
    registerDefinition(name, definition);
    // 7.1.7. Run custom element constructor generation algorithm with PROTOTYPE
    // 7.1.8. Return the output of the previous step.
    definition.ctor = generateConstructor(definition);
    definition.ctor.prototype = definition.prototype;
    // force our .constructor to be our actual constructor
    definition.prototype.constructor = definition.ctor;
    // if initial parsing is complete
    if (scope.ready) {
      // upgrade any pre-existing nodes of this type
      scope.upgradeAll(document);
    }
    return definition.ctor;
  }

  function ancestry(extnds) {
    var extendee = registry[extnds];
    if (extendee) {
      return ancestry(extendee.extends).concat([extendee]);
    }
    return [];
  }

  function resolveTagName(definition) {
    // if we are explicitly extending something, that thing is our
    // baseTag, unless it represents a custom component
    var baseTag = definition.extends;
    // if our ancestry includes custom components, we only have a
    // baseTag if one of them does
    for (var i=0, a; (a=definition.ancestry[i]); i++) {
      baseTag = a.is && a.tag;
    }
    // our tag is our baseTag, if it exists, and otherwise just our name
    definition.tag = baseTag || definition.name;
    if (baseTag) {
      // if there is a base tag, use secondary 'is' specifier
      definition.is = definition.name;
    }
  }

  function resolvePrototypeChain(definition) {
    // if we don't support __proto__ we need to locate the native level
    // prototype for precise mixing in
    if (!Object.__proto__) {
      // default prototype
      var nativePrototype = HTMLElement.prototype;
      // work out prototype when using type-extension
      if (definition.is) {
        var inst = document.createElement(definition.tag);
        nativePrototype = Object.getPrototypeOf(inst);
      }
      // ensure __proto__ reference is installed at each point on the prototype
      // chain.
      // NOTE: On platforms without __proto__, a mixin strategy is used instead
      // of prototype swizzling. In this case, this generated __proto__ provides
      // limited support for prototype traversal.
      var proto = definition.prototype, ancestor;
      while (proto && (proto !== nativePrototype)) {
        var ancestor = Object.getPrototypeOf(proto);
        proto.__proto__ = ancestor;
        proto = ancestor;
      }
    }
    // cache this in case of mixin
    definition.native = nativePrototype;
  }

  // SECTION 4

  function instantiate(definition) {
    // 4.a.1. Create a new object that implements PROTOTYPE
    // 4.a.2. Let ELEMENT by this new object
    //
    // the custom element instantiation algorithm must also ensure that the
    // output is a valid DOM element with the proper wrapper in place.
    //
    return upgrade(domCreateElement(definition.tag), definition);
  }

  function upgrade(element, definition) {
    // some definitions specify an 'is' attribute
    if (definition.is) {
      element.setAttribute('is', definition.is);
    }
    // make 'element' implement definition.prototype
    implement(element, definition);
    // flag as upgraded
    element.__upgraded__ = true;
    // there should never be a shadow root on element at this point
    // we require child nodes be upgraded before `created`
    scope.upgradeSubtree(element);
    // lifecycle management
    created(element);
    // OUTPUT
    return element;
  }

  function implement(element, definition) {
    // prototype swizzling is best
    if (Object.__proto__) {
      element.__proto__ = definition.prototype;
    } else {
      // where above we can re-acquire inPrototype via
      // getPrototypeOf(Element), we cannot do so when
      // we use mixin, so we install a magic reference
      customMixin(element, definition.prototype, definition.native);
      element.__proto__ = definition.prototype;
    }
  }

  function customMixin(inTarget, inSrc, inNative) {
    // TODO(sjmiles): 'used' allows us to only copy the 'youngest' version of
    // any property. This set should be precalculated. We also need to
    // consider this for supporting 'super'.
    var used = {};
    // start with inSrc
    var p = inSrc;
    // sometimes the default is HTMLUnknownElement.prototype instead of
    // HTMLElement.prototype, so we add a test
    // the idea is to avoid mixing in native prototypes, so adding
    // the second test is WLOG
    while (p !== inNative && p !== HTMLUnknownElement.prototype) {
      var keys = Object.getOwnPropertyNames(p);
      for (var i=0, k; k=keys[i]; i++) {
        if (!used[k]) {
          Object.defineProperty(inTarget, k,
              Object.getOwnPropertyDescriptor(p, k));
          used[k] = 1;
        }
      }
      p = Object.getPrototypeOf(p);
    }
  }

  function created(element) {
    // invoke createdCallback
    if (element.createdCallback) {
      element.createdCallback();
    }
  }

  // attribute watching

  function overrideAttributeApi(prototype) {
    // overrides to implement callbacks
    // TODO(sjmiles): should support access via .attributes NamedNodeMap
    // TODO(sjmiles): preserves user defined overrides, if any
    var setAttribute = prototype.setAttribute;
    prototype.setAttribute = function(name, value) {
      changeAttribute.call(this, name, value, setAttribute);
    }
    var removeAttribute = prototype.removeAttribute;
    prototype.removeAttribute = function(name, value) {
      changeAttribute.call(this, name, value, removeAttribute);
    }
  }

  function changeAttribute(name, value, operation) {
    var oldValue = this.getAttribute(name);
    operation.apply(this, arguments);
    if (this.attributeChangedCallback
        && (this.getAttribute(name) !== oldValue)) {
      this.attributeChangedCallback(name, oldValue);
    }
  }

  // element registry (maps tag names to definitions)

  var registry = {};

  function registerDefinition(name, definition) {
    registry[name] = definition;
  }

  function generateConstructor(definition) {
    return function() {
      return instantiate(definition);
    };
  }

  function createElement(tag, typeExtension) {
    // TODO(sjmiles): ignore 'tag' when using 'typeExtension', we could
    // error check it, or perhaps there should only ever be one argument
    var definition = registry[typeExtension || tag];
    if (definition) {
      return new definition.ctor();
    }
    return domCreateElement(tag);
  }

  function upgradeElement(element) {
    if (!element.__upgraded__ && (element.nodeType === Node.ELEMENT_NODE)) {
      var type = element.getAttribute('is') || element.localName;
      var definition = registry[type];
      return definition && upgrade(element, definition);
    }
  }

  function cloneNode(deep) {
    // call original clone
    var n = domCloneNode.call(this, deep);
    // upgrade the element and subtree
    scope.upgradeAll(n);
    // return the clone
    return n;
  }
  // capture native createElement before we override it

  var domCreateElement = document.createElement.bind(document);

  // capture native cloneNode before we override it

  var domCloneNode = Node.prototype.cloneNode;

  // exports

  document.register = register;
  document.createElement = createElement; // override
  Node.prototype.cloneNode = cloneNode; // override

  scope.registry = registry;

  /**
   * Upgrade an element to a custom element. Upgrading an element
   * causes the custom prototype to be applied, an `is` attribute
   * to be attached (as needed), and invocation of the `readyCallback`.
   * `upgrade` does nothing if the element is already upgraded, or
   * if it matches no registered custom tag name.
   *
   * @method ugprade
   * @param {Element} element The element to upgrade.
   * @return {Element} The upgraded element.
   */
  scope.upgrade = upgradeElement;
}

scope.hasNative = hasNative;
scope.useNative = useNative;

})(window.CustomElements);

 /*
Copyright 2013 The Polymer Authors. All rights reserved.
Use of this source code is governed by a BSD-style
license that can be found in the LICENSE file.
*/

(function(scope){

var logFlags = window.logFlags || {};

// walk the subtree rooted at node, applying 'find(element, data)' function
// to each element
// if 'find' returns true for 'element', do not search element's subtree
function findAll(node, find, data) {
  var e = node.firstElementChild;
  if (!e) {
    e = node.firstChild;
    while (e && e.nodeType !== Node.ELEMENT_NODE) {
      e = e.nextSibling;
    }
  }
  while (e) {
    if (find(e, data) !== true) {
      findAll(e, find, data);
    }
    e = e.nextElementSibling;
  }
  return null;
}

// walk all shadowRoots on a given node.
function forRoots(node, cb) {
  var root = node.shadowRoot;
  while(root) {
    forSubtree(root, cb);
    root = root.olderShadowRoot;
  }
}

// walk the subtree rooted at node, including descent into shadow-roots,
// applying 'cb' to each element
function forSubtree(node, cb) {
  //logFlags.dom && node.childNodes && node.childNodes.length && console.group('subTree: ', node);
  findAll(node, function(e) {
    if (cb(e)) {
      return true;
    }
    forRoots(e, cb);
  });
  forRoots(node, cb);
  //logFlags.dom && node.childNodes && node.childNodes.length && console.groupEnd();
}

// manage lifecycle on added node
function added(node) {
  if (upgrade(node)) {
    insertedNode(node);
    return true;
  }
  inserted(node);
}

// manage lifecycle on added node's subtree only
function addedSubtree(node) {
  forSubtree(node, function(e) {
    if (added(e)) {
      return true;
    }
  });
}

// manage lifecycle on added node and it's subtree
function addedNode(node) {
  return added(node) || addedSubtree(node);
}

// upgrade custom elements at node, if applicable
function upgrade(node) {
  if (!node.__upgraded__ && node.nodeType === Node.ELEMENT_NODE) {
    var type = node.getAttribute('is') || node.localName;
    var definition = scope.registry[type];
    if (definition) {
      logFlags.dom && console.group('upgrade:', node.localName);
      scope.upgrade(node);
      logFlags.dom && console.groupEnd();
      return true;
    }
  }
}

function insertedNode(node) {
  inserted(node);
  if (inDocument(node)) {
    forSubtree(node, function(e) {
      inserted(e);
    });
  }
}


// TODO(sorvell): on platforms without MutationObserver, mutations may not be
// reliable and therefore entered/leftView are not reliable.
// To make these callbacks less likely to fail, we defer all inserts and removes
// to give a chance for elements to be inserted into dom.
// This ensures enteredViewCallback fires for elements that are created and
// immediately added to dom.
var hasPolyfillMutations = (!window.MutationObserver ||
    (window.MutationObserver === window.JsMutationObserver));
scope.hasPolyfillMutations = hasPolyfillMutations;

var isPendingMutations = false;
var pendingMutations = [];
function deferMutation(fn) {
  pendingMutations.push(fn);
  if (!isPendingMutations) {
    isPendingMutations = true;
    var async = (window.Platform && window.Platform.endOfMicrotask) ||
        setTimeout;
    async(takeMutations);
  }
}

function takeMutations() {
  isPendingMutations = false;
  var $p = pendingMutations;
  for (var i=0, l=$p.length, p; (i<l) && (p=$p[i]); i++) {
    p();
  }
  pendingMutations = [];
}

function inserted(element) {
  if (hasPolyfillMutations) {
    deferMutation(function() {
      _inserted(element);
    });
  } else {
    _inserted(element);
  }
}

// TODO(sjmiles): if there are descents into trees that can never have inDocument(*) true, fix this
function _inserted(element) {
  // TODO(sjmiles): it's possible we were inserted and removed in the space
  // of one microtask, in which case we won't be 'inDocument' here
  // But there are other cases where we are testing for inserted without
  // specific knowledge of mutations, and must test 'inDocument' to determine
  // whether to call inserted
  // If we can factor these cases into separate code paths we can have
  // better diagnostics.
  // TODO(sjmiles): when logging, do work on all custom elements so we can
  // track behavior even when callbacks not defined
  //console.log('inserted: ', element.localName);
  if (element.enteredViewCallback || (element.__upgraded__ && logFlags.dom)) {
    logFlags.dom && console.group('inserted:', element.localName);
    if (inDocument(element)) {
      element.__inserted = (element.__inserted || 0) + 1;
      // if we are in a 'removed' state, bluntly adjust to an 'inserted' state
      if (element.__inserted < 1) {
        element.__inserted = 1;
      }
      // if we are 'over inserted', squelch the callback
      if (element.__inserted > 1) {
        logFlags.dom && console.warn('inserted:', element.localName,
          'insert/remove count:', element.__inserted)
      } else if (element.enteredViewCallback) {
        logFlags.dom && console.log('inserted:', element.localName);
        element.enteredViewCallback();
      }
    }
    logFlags.dom && console.groupEnd();
  }
}

function removedNode(node) {
  removed(node);
  forSubtree(node, function(e) {
    removed(e);
  });
}


function removed(element) {
  if (hasPolyfillMutations) {
    deferMutation(function() {
      _removed(element);
    });
  } else {
    _removed(element);
  }
}

function removed(element) {
  // TODO(sjmiles): temporary: do work on all custom elements so we can track
  // behavior even when callbacks not defined
  if (element.leftViewCallback || (element.__upgraded__ && logFlags.dom)) {
    logFlags.dom && console.log('removed:', element.localName);
    if (!inDocument(element)) {
      element.__inserted = (element.__inserted || 0) - 1;
      // if we are in a 'inserted' state, bluntly adjust to an 'removed' state
      if (element.__inserted > 0) {
        element.__inserted = 0;
      }
      // if we are 'over removed', squelch the callback
      if (element.__inserted < 0) {
        logFlags.dom && console.warn('removed:', element.localName,
            'insert/remove count:', element.__inserted)
      } else if (element.leftViewCallback) {
        element.leftViewCallback();
      }
    }
  }
}

function inDocument(element) {
  var p = element;
  var doc = window.ShadowDOMPolyfill &&
      window.ShadowDOMPolyfill.wrapIfNeeded(document) || document;
  while (p) {
    if (p == doc) {
      return true;
    }
    p = p.parentNode || p.host;
  }
}

function watchShadow(node) {
  if (node.shadowRoot && !node.shadowRoot.__watched) {
    logFlags.dom && console.log('watching shadow-root for: ', node.localName);
    // watch all unwatched roots...
    var root = node.shadowRoot;
    while (root) {
      watchRoot(root);
      root = root.olderShadowRoot;
    }
  }
}

function watchRoot(root) {
  if (!root.__watched) {
    observe(root);
    root.__watched = true;
  }
}

function filter(inNode) {
  switch (inNode.localName) {
    case 'style':
    case 'script':
    case 'template':
    case undefined:
      return true;
  }
}

function handler(mutations) {
  //
  if (logFlags.dom) {
    var mx = mutations[0];
    if (mx && mx.type === 'childList' && mx.addedNodes) {
        if (mx.addedNodes) {
          var d = mx.addedNodes[0];
          while (d && d !== document && !d.host) {
            d = d.parentNode;
          }
          var u = d && (d.URL || d._URL || (d.host && d.host.localName)) || '';
          u = u.split('/?').shift().split('/').pop();
        }
    }
    console.group('mutations (%d) [%s]', mutations.length, u || '');
  }
  //
  mutations.forEach(function(mx) {
    //logFlags.dom && console.group('mutation');
    if (mx.type === 'childList') {
      forEach(mx.addedNodes, function(n) {
        //logFlags.dom && console.log(n.localName);
        if (filter(n)) {
          return;
        }
        // nodes added may need lifecycle management
        addedNode(n);
      });
      // removed nodes may need lifecycle management
      forEach(mx.removedNodes, function(n) {
        //logFlags.dom && console.log(n.localName);
        if (filter(n)) {
          return;
        }
        removedNode(n);
      });
    }
    //logFlags.dom && console.groupEnd();
  });
  logFlags.dom && console.groupEnd();
};

var observer = new MutationObserver(handler);

function takeRecords() {
  // TODO(sjmiles): ask Raf why we have to call handler ourselves
  handler(observer.takeRecords());
  takeMutations();
}

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

function observe(inRoot) {
  observer.observe(inRoot, {childList: true, subtree: true});
}

function observeDocument(document) {
  observe(document);
}

function upgradeDocument(document) {
  logFlags.dom && console.group('upgradeDocument: ', (document.URL || document._URL || '').split('/').pop());
  addedNode(document);
  logFlags.dom && console.groupEnd();
}

// exports

scope.watchShadow = watchShadow;
scope.upgradeAll = addedNode;
scope.upgradeSubtree = addedSubtree;

scope.observeDocument = observeDocument;
scope.upgradeDocument = upgradeDocument;

scope.takeRecords = takeRecords;

})(window.CustomElements);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {

if (!scope) {
  scope = window.HTMLImports = {flags:{}};
}

// imports

var xhr = scope.xhr;

// importer

var IMPORT_LINK_TYPE = 'import';
var STYLE_LINK_TYPE = 'stylesheet';

// highlander object represents a primary document (the argument to 'load')
// at the root of a tree of documents

// for any document, importer:
// - loads any linked documents (with deduping), modifies paths and feeds them back into importer
// - loads text of external script tags
// - loads text of external style tags inside of <element>, modifies paths

// when importer 'modifies paths' in a document, this includes
// - href/src/action in node attributes
// - paths in inline stylesheets
// - all content inside templates

// linked style sheets in an import have their own path fixed up when their containing import modifies paths
// linked style sheets in an <element> are loaded, and the content gets path fixups
// inline style sheets get path fixups when their containing import modifies paths

var loader;

var importer = {
  documents: {},
  cache: {},
  preloadSelectors: [
    'link[rel=' + IMPORT_LINK_TYPE + ']',
    'element link[rel=' + STYLE_LINK_TYPE + ']',
    'template',
    'script[src]:not([type])',
    'script[src][type="text/javascript"]'
  ].join(','),
  loader: function(next) {
    // construct a loader instance
    loader = new Loader(importer.loaded, next);
    // alias the loader cache (for debugging)
    loader.cache = importer.cache;
    return loader;
  },
  load: function(doc, next) {
    // construct a loader instance
    loader = importer.loader(next);
    // add nodes from document into loader queue
    importer.preload(doc);
  },
  preload: function(doc) {
    // all preloadable nodes in inDocument
    var nodes = doc.querySelectorAll(importer.preloadSelectors);
    // from the main document, only load imports
    // TODO(sjmiles): do this by altering the selector list instead
    nodes = this.filterMainDocumentNodes(doc, nodes);
    // extra link nodes from templates, filter templates out of the nodes list
    nodes = this.extractTemplateNodes(nodes);
    // add these nodes to loader's queue
    loader.addNodes(nodes);
  },
  filterMainDocumentNodes: function(doc, nodes) {
    if (doc === document) {
      nodes = Array.prototype.filter.call(nodes, function(n) {
        return !isScript(n);
      });
    }
    return nodes;
  },
  extractTemplateNodes: function(nodes) {
    var extra = [];
    nodes = Array.prototype.filter.call(nodes, function(n) {
      if (n.localName === 'template') {
        if (n.content) {
          var l$ = n.content.querySelectorAll('link[rel=' + STYLE_LINK_TYPE +
            ']');
          if (l$.length) {
            extra = extra.concat(Array.prototype.slice.call(l$, 0));
          }
        }
        return false;
      }
      return true;
    });
    if (extra.length) {
      nodes = nodes.concat(extra);
    }
    return nodes;
  },
  loaded: function(url, elt, resource) {
    if (isDocumentLink(elt)) {
      var document = importer.documents[url];
      // if we've never seen a document at this url
      if (!document) {
        // generate an HTMLDocument from data
        document = makeDocument(resource, url);
        // resolve resource paths relative to host document
        path.resolvePathsInHTML(document);
        // cache document
        importer.documents[url] = document;
        // add nodes from this document to the loader queue
        importer.preload(document);
      }
      // store import record
      elt.import = {
        href: url,
        ownerNode: elt,
        content: document
      };
      // store document resource
      elt.content = resource = document;
    }
    // store generic resource
    // TODO(sorvell): fails for nodes inside <template>.content
    // see https://code.google.com/p/chromium/issues/detail?id=249381.
    elt.__resource = resource;
    // css path fixups
    if (isStylesheetLink(elt)) {
      path.resolvePathsInStylesheet(elt);
    }
  }
};

function isDocumentLink(elt) {
  return isLinkRel(elt, IMPORT_LINK_TYPE);
}

function isStylesheetLink(elt) {
  return isLinkRel(elt, STYLE_LINK_TYPE);
}

function isLinkRel(elt, rel) {
  return elt.localName === 'link' && elt.getAttribute('rel') === rel;
}

function isScript(elt) {
  return elt.localName === 'script';
}

function makeDocument(resource, url) {
  // create a new HTML document
  var doc = resource;
  if (!(doc instanceof Document)) {
    doc = document.implementation.createHTMLDocument(IMPORT_LINK_TYPE);
    // install html
    doc.body.innerHTML = resource;
  }
  // cache the new document's source url
  doc._URL = url;
  // establish a relative path via <base>
  var base = doc.createElement('base');
  base.setAttribute('href', document.baseURI || document.URL);
  doc.head.appendChild(base);
  // TODO(sorvell): ideally this code is not aware of Template polyfill,
  // but for now the polyfill needs help to bootstrap these templates
  if (window.HTMLTemplateElement && HTMLTemplateElement.bootstrap) {
    HTMLTemplateElement.bootstrap(doc);
  }
  return doc;
}

var Loader = function(onLoad, onComplete) {
  this.onload = onLoad;
  this.oncomplete = onComplete;
  this.inflight = 0;
  this.pending = {};
  this.cache = {};
};

Loader.prototype = {
  addNodes: function(nodes) {
    // number of transactions to complete
    this.inflight += nodes.length;
    // commence transactions
    forEach(nodes, this.require, this);
    // anything to do?
    this.checkDone();
  },
  require: function(elt) {
    var url = path.nodeUrl(elt);
    // TODO(sjmiles): ad-hoc
    elt.__nodeUrl = url;
    // deduplication
    if (!this.dedupe(url, elt)) {
      // fetch this resource
      this.fetch(url, elt);
    }
  },
  dedupe: function(url, elt) {
    if (this.pending[url]) {
      // add to list of nodes waiting for inUrl
      this.pending[url].push(elt);
      // don't need fetch
      return true;
    }
    if (this.cache[url]) {
      // complete load using cache data
      this.onload(url, elt, loader.cache[url]);
      // finished this transaction
      this.tail();
      // don't need fetch
      return true;
    }
    // first node waiting for inUrl
    this.pending[url] = [elt];
    // need fetch (not a dupe)
    return false;
  },
  fetch: function(url, elt) {
    var receiveXhr = function(err, resource) {
      this.receive(url, elt, err, resource);
    }.bind(this);
    xhr.load(url, receiveXhr);
    // TODO(sorvell): blocked on
    // https://code.google.com/p/chromium/issues/detail?id=257221
    // xhr'ing for a document makes scripts in imports runnable; otherwise
    // they are not; however, it requires that we have doctype=html in
    // the import which is unacceptable. This is only needed on Chrome
    // to avoid the bug above.
    /*
    if (isDocumentLink(elt)) {
      xhr.loadDocument(url, receiveXhr);
    } else {
      xhr.load(url, receiveXhr);
    }
    */
  },
  receive: function(url, elt, err, resource) {
    if (!err) {
      loader.cache[url] = resource;
    }
    loader.pending[url].forEach(function(e) {
      if (!err) {
        this.onload(url, e, resource);
      }
      this.tail();
    }, this);
    loader.pending[url] = null;
  },
  tail: function() {
    --this.inflight;
    this.checkDone();
  },
  checkDone: function() {
    if (!this.inflight) {
      this.oncomplete();
    }
  }
};

var URL_ATTRS = ['href', 'src', 'action'];
var URL_ATTRS_SELECTOR = '[' + URL_ATTRS.join('],[') + ']';
var URL_TEMPLATE_SEARCH = '{{.*}}';

var path = {
  nodeUrl: function(node) {
    return path.resolveUrl(path.documentURL, path.hrefOrSrc(node));
  },
  hrefOrSrc: function(node) {
    return node.getAttribute("href") || node.getAttribute("src");
  },
  documentUrlFromNode: function(node) {
    return path.getDocumentUrl(node.ownerDocument || node);
  },
  getDocumentUrl: function(doc) {
    var url = doc &&
        // TODO(sjmiles): ShadowDOMPolyfill intrusion
        (doc._URL || (doc.impl && doc.impl._URL)
            || doc.baseURI || doc.URL)
                || '';
    // take only the left side if there is a #
    return url.split('#')[0];
  },
  resolveUrl: function(baseUrl, url) {
    if (this.isAbsUrl(url)) {
      return url;
    }
    return this.compressUrl(this.urlToPath(baseUrl) + url);
  },
  resolveRelativeUrl: function(baseUrl, url) {
    if (this.isAbsUrl(url)) {
      return url;
    }
    return this.makeDocumentRelPath(this.resolveUrl(baseUrl, url));
  },
  isAbsUrl: function(url) {
    return /(^data:)|(^http[s]?:)|(^\/)/.test(url);
  },
  urlToPath: function(baseUrl) {
    var parts = baseUrl.split("/");
    parts.pop();
    parts.push('');
    return parts.join("/");
  },
  compressUrl: function(url) {
    var search = '';
    var searchPos = url.indexOf('?');
    // query string is not part of the path
    if (searchPos > -1) {
      search = url.substring(searchPos);
      url = url.substring(searchPos, 0);
    }
    var parts = url.split('/');
    for (var i=0, p; i<parts.length; i++) {
      p = parts[i];
      if (p === '..') {
        parts.splice(i-1, 2);
        i -= 2;
      }
    }
    return parts.join('/') + search;
  },
  makeDocumentRelPath: function(url) {
    // test url against document to see if we can construct a relative path
    path.urlElt.href = url;
    // IE does not set host if same as document
    if (!path.urlElt.host ||
        (path.urlElt.host === window.location.host &&
        path.urlElt.protocol === window.location.protocol)) {
      return this.makeRelPath(path.documentURL, path.urlElt.href);
    } else {
      return url;
    }
  },
  // make a relative path from source to target
  makeRelPath: function(source, target) {
    var s = source.split('/');
    var t = target.split('/');
    while (s.length && s[0] === t[0]){
      s.shift();
      t.shift();
    }
    for(var i = 0, l = s.length-1; i < l; i++) {
      t.unshift('..');
    }
    var r = t.join('/');
    return r;
  },
  resolvePathsInHTML: function(root, url) {
    url = url || path.documentUrlFromNode(root)
    path.resolveAttributes(root, url);
    path.resolveStyleElts(root, url);
    // handle template.content
    var templates = root.querySelectorAll('template');
    if (templates) {
      forEach(templates, function(t) {
        if (t.content) {
          path.resolvePathsInHTML(t.content, url);
        }
      });
    }
  },
  resolvePathsInStylesheet: function(sheet) {
    var docUrl = path.nodeUrl(sheet);
    sheet.__resource = path.resolveCssText(sheet.__resource, docUrl);
  },
  resolveStyleElts: function(root, url) {
    var styles = root.querySelectorAll('style');
    if (styles) {
      forEach(styles, function(style) {
        style.textContent = path.resolveCssText(style.textContent, url);
      });
    }
  },
  resolveCssText: function(cssText, baseUrl) {
    return cssText.replace(/url\([^)]*\)/g, function(match) {
      // find the url path, ignore quotes in url string
      var urlPath = match.replace(/["']/g, "").slice(4, -1);
      urlPath = path.resolveRelativeUrl(baseUrl, urlPath);
      return "url(" + urlPath + ")";
    });
  },
  resolveAttributes: function(root, url) {
    // search for attributes that host urls
    var nodes = root && root.querySelectorAll(URL_ATTRS_SELECTOR);
    if (nodes) {
      forEach(nodes, function(n) {
        this.resolveNodeAttributes(n, url);
      }, this);
    }
  },
  resolveNodeAttributes: function(node, url) {
    URL_ATTRS.forEach(function(v) {
      var attr = node.attributes[v];
      if (attr && attr.value &&
         (attr.value.search(URL_TEMPLATE_SEARCH) < 0)) {
        var urlPath = path.resolveRelativeUrl(url, attr.value);
        attr.value = urlPath;
      }
    });
  }
};

path.documentURL = path.getDocumentUrl(document);
path.urlElt = document.createElement('a');

xhr = xhr || {
  async: true,
  ok: function(request) {
    return (request.status >= 200 && request.status < 300)
        || (request.status === 304)
        || (request.status === 0);
  },
  load: function(url, next, nextContext) {
    var request = new XMLHttpRequest();
    if (scope.flags.debug || scope.flags.bust) {
      url += '?' + Math.random();
    }
    request.open('GET', url, xhr.async);
    request.addEventListener('readystatechange', function(e) {
      if (request.readyState === 4) {
        next.call(nextContext, !xhr.ok(request) && request,
          request.response, url);
      }
    });
    request.send();
    return request;
  },
  loadDocument: function(url, next, nextContext) {
    this.load(url, next, nextContext).responseType = 'document';
  }
};

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

// exports

scope.path = path;
scope.xhr = xhr;
scope.importer = importer;
scope.getDocumentUrl = path.getDocumentUrl;
scope.IMPORT_LINK_TYPE = IMPORT_LINK_TYPE;

})(window.HTMLImports);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {

var IMPORT_LINK_TYPE = 'import';

// highlander object for parsing a document tree

var importParser = {
  selectors: [
    'link[rel=' + IMPORT_LINK_TYPE + ']',
    'link[rel=stylesheet]',
    'style',
    'script:not([type])',
    'script[type="text/javascript"]'
  ],
  map: {
    link: 'parseLink',
    script: 'parseScript',
    style: 'parseGeneric'
  },
  parse: function(inDocument) {
    if (!inDocument.__importParsed) {
      // only parse once
      inDocument.__importParsed = true;
      // all parsable elements in inDocument (depth-first pre-order traversal)
      var elts = inDocument.querySelectorAll(importParser.selectors);
      // for each parsable node type, call the mapped parsing method
      forEach(elts, function(e) {
        importParser[importParser.map[e.localName]](e);
      });
    }
  },
  parseLink: function(linkElt) {
    if (isDocumentLink(linkElt)) {
      if (linkElt.content) {
        importParser.parse(linkElt.content);
      }
    } else {
      this.parseGeneric(linkElt);
    }
  },
  parseGeneric: function(elt) {
    if (needsMainDocumentContext(elt)) {
      document.head.appendChild(elt);
    }
  },
  parseScript: function(scriptElt) {
    if (needsMainDocumentContext(scriptElt)) {
      // acquire code to execute
      var code = (scriptElt.__resource || scriptElt.textContent).trim();
      if (code) {
        // calculate source map hint
        var moniker = scriptElt.__nodeUrl;
        if (!moniker) {
          var moniker = scope.path.documentUrlFromNode(scriptElt);
          // there could be more than one script this url
          var tag = '[' + Math.floor((Math.random()+1)*1000) + ']';
          // TODO(sjmiles): Polymer hack, should be pluggable if we need to allow
          // this sort of thing
          var matches = code.match(/Polymer\(['"]([^'"]*)/);
          tag = matches && matches[1] || tag;
          // tag the moniker
          moniker += '/' + tag + '.js';
        }
        // source map hint
        code += "\n//# sourceURL=" + moniker + "\n";
        // evaluate the code
        eval.call(window, code);
      }
    }
  }
};

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

function isDocumentLink(elt) {
  return elt.localName === 'link'
      && elt.getAttribute('rel') === IMPORT_LINK_TYPE;
}

function needsMainDocumentContext(node) {
  // nodes can be moved to the main document:
  // if they are in a tree but not in the main document and not children of <element>
  return node.parentNode && !inMainDocument(node)
      && !isElementElementChild(node);
}

function inMainDocument(elt) {
  return elt.ownerDocument === document ||
    // TODO(sjmiles): ShadowDOMPolyfill intrusion
    elt.ownerDocument.impl === document;
}

function isElementElementChild(elt) {
  return elt.parentNode && elt.parentNode.localName === 'element';
}

// exports

scope.parser = importParser;

})(HTMLImports);
/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */
(function(){

// bootstrap

// IE shim for CustomEvent
if (typeof window.CustomEvent !== 'function') {
  window.CustomEvent = function(inType) {
     var e = document.createEvent('HTMLEvents');
     e.initEvent(inType, true, true);
     return e;
  };
}

function bootstrap() {
  // preload document resource trees
  HTMLImports.importer.load(document, function() {
    HTMLImports.parser.parse(document);
    HTMLImports.readyTime = new Date().getTime();
    // send HTMLImportsLoaded when finished
    document.dispatchEvent(
      new CustomEvent('HTMLImportsLoaded', {bubbles: true})
    );
  });
};

if (document.readyState === 'complete') {
  bootstrap();
} else {
  window.addEventListener('DOMContentLoaded', bootstrap);
}

})();

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function() {

// import

var IMPORT_LINK_TYPE = window.HTMLImports ? HTMLImports.IMPORT_LINK_TYPE : 'none';

// highlander object for parsing a document tree

var parser = {
  selectors: [
    'link[rel=' + IMPORT_LINK_TYPE + ']'
  ],
  map: {
    link: 'parseLink'
  },
  parse: function(inDocument) {
    if (!inDocument.__parsed) {
      // only parse once
      inDocument.__parsed = true;
      // all parsable elements in inDocument (depth-first pre-order traversal)
      var elts = inDocument.querySelectorAll(parser.selectors);
      // for each parsable node type, call the mapped parsing method
      forEach(elts, function(e) {
        parser[parser.map[e.localName]](e);
      });
      // upgrade all upgradeable static elements, anything dynamically
      // created should be caught by observer
      CustomElements.upgradeDocument(inDocument);
      // observe document for dom changes
      CustomElements.observeDocument(inDocument);
    }
  },
  parseLink: function(linkElt) {
    // imports
    if (isDocumentLink(linkElt)) {
      this.parseImport(linkElt);
    }
  },
  parseImport: function(linkElt) {
    if (linkElt.content) {
      parser.parse(linkElt.content);
    }
  }
};

function isDocumentLink(inElt) {
  return (inElt.localName === 'link'
      && inElt.getAttribute('rel') === IMPORT_LINK_TYPE);
}

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

// exports

CustomElements.parser = parser;

})();
/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */
(function(){

// bootstrap parsing
function bootstrap() {
  // parse document
  CustomElements.parser.parse(document);
  // one more pass before register is 'live'
  CustomElements.upgradeDocument(document);
  // choose async
  var async = window.Platform && Platform.endOfMicrotask ?
    Platform.endOfMicrotask :
    setTimeout;
  async(function() {
    // set internal 'ready' flag, now document.register will trigger
    // synchronous upgrades
    CustomElements.ready = true;
    // capture blunt profiling data
    CustomElements.readyTime = Date.now();
    if (window.HTMLImports) {
      CustomElements.elapsed = CustomElements.readyTime - HTMLImports.readyTime;
    }
    // notify the system that we are bootstrapped
    document.body.dispatchEvent(
      new CustomEvent('WebComponentsReady', {bubbles: true})
    );
  });
}

// CustomEvent shim for IE
if (typeof window.CustomEvent !== 'function') {
  window.CustomEvent = function(inType) {
     var e = document.createEvent('HTMLEvents');
     e.initEvent(inType, true, true);
     return e;
  };
}

if (document.readyState === 'complete') {
  bootstrap();
} else {
  var loadEvent = window.HTMLImports ? 'HTMLImportsLoaded' : 'DOMContentLoaded';
  window.addEventListener(loadEvent, bootstrap);
}

})();

(function () {

/*** Variables ***/

  var win = window,
    doc = document,
    noop = function(){},
    trueop = function(){ return true; },
    regexPseudoSplit = /([\w-]+(?:\([^\)]+\))?)/g,
    regexPseudoReplace = /(\w*)(?:\(([^\)]*)\))?/,
    regexDigits = /(\d+)/g,
    keypseudo = {
      action: function (pseudo, event) {
        return pseudo.value.match(regexDigits).indexOf(String(event.keyCode)) > -1 == (pseudo.name == 'keypass') || null;
      }
    },
    prefix = (function () {
      var styles = win.getComputedStyle(doc.documentElement, ''),
          pre = (Array.prototype.slice
            .call(styles)
            .join('')
            .match(/-(moz|webkit|ms)-/) || (styles.OLink === '' && ['', 'o'])
          )[1];
      return {
        dom: pre == 'ms' ? 'MS' : pre,
        lowercase: pre,
        css: '-' + pre + '-',
        js: pre == 'ms' ? pre : pre[0].toUpperCase() + pre.substr(1)
      };
    })(),
    matchSelector = Element.prototype.matchesSelector || Element.prototype[prefix.lowercase + 'MatchesSelector'],
    mutation = win.MutationObserver || win[prefix.js + 'MutationObserver'];

/*** Functions ***/

// Utilities

  var typeCache = {},
      typeString = typeCache.toString,
      typeRegexp = /\s([a-zA-Z]+)/;
  function typeOf(obj) {
    var type = typeString.call(obj);
    return typeCache[type] || (typeCache[type] = type.match(typeRegexp)[1].toLowerCase());
  }

  function clone(item, type){
    var fn = clone[type || typeOf(item)];
    return fn ? fn(item) : item;
  }
    clone.object = function(src){
      var obj = {};
      for (var key in src) obj[key] = clone(src[key]);
      return obj;
    };
    clone.array = function(src){
      var i = src.length, array = new Array(i);
      while (i--) array[i] = clone(src[i]);
      return array;
    };

  var unsliceable = ['undefined', 'null', 'number', 'boolean', 'string', 'function'];
  function toArray(obj){
    return unsliceable.indexOf(typeOf(obj)) == -1 ?
    Array.prototype.slice.call(obj, 0) :
    [obj];
  }

// DOM
  var str = '';
  function query(element, selector){
    return (selector || str).length ? toArray(element.querySelectorAll(selector)) : [];
  }

  function parseMutations(element, mutations) {
    var diff = { added: [], removed: [] };
    mutations.forEach(function(record){
      record._mutation = true;
      for (var z in diff) {
        var type = element._records[(z == 'added') ? 'inserted' : 'removed'],
          nodes = record[z + 'Nodes'], length = nodes.length;
        for (var i = 0; i < length && diff[z].indexOf(nodes[i]) == -1; i++){
          diff[z].push(nodes[i]);
          type.forEach(function(fn){
            fn(nodes[i], record);
          });
        }
      }
    });
  }

// Mixins

  function mergeOne(source, key, current){
    var type = typeOf(current);
    if (type == 'object' && typeOf(source[key]) == 'object') xtag.merge(source[key], current);
    else source[key] = clone(current, type);
    return source;
  }

  function wrapMixin(tag, key, pseudo, value, original){
    if (typeof original[key] != 'function') original[key] = value;
    else {
      original[key] = xtag.wrap(original[key], xtag.applyPseudos(pseudo, value, tag.pseudos));
    }
  }

  var uniqueMixinCount = 0;
  function mergeMixin(tag, mixin, original, mix) {
    if (mix) {
      var uniques = {};
      for (var z in original) uniques[z.split(':')[0]] = z;
      for (z in mixin) {
        wrapMixin(tag, uniques[z.split(':')[0]] || z, z, mixin[z], original);
      }
    }
    else {
      for (var zz in mixin){
        wrapMixin(tag, zz + ':__mixin__(' + (uniqueMixinCount++) + ')', zz, mixin[zz], original);
      }
    }
  }

  function applyMixins(tag) {
    tag.mixins.forEach(function (name) {
      var mixin = xtag.mixins[name];
      for (var type in mixin) {
        var item = mixin[type],
            original = tag[type];
        if (!original) tag[type] = item;
        else {
          switch (type){
            case 'accessors': case 'prototype':
              for (var z in item) {
                if (!original[z]) original[z] = item[z];
                else mergeMixin(tag, item[z], original[z], true);
              }
              break;
            default: mergeMixin(tag, item, original, type != 'events');
          }
        }
      }
    });
    return tag;
  }

// Events

  function delegateAction(pseudo, event) {
    var target = query(this, pseudo.value).filter(function(node){
      return node == event.target || node.contains ? node.contains(event.target) : null;
    })[0];
    return target ? pseudo.listener = pseudo.listener.bind(target) : null;
  }

  function touchFilter(event) {
    if (event.type.match('touch')){
      event.target.__touched__ = true;
    }
    else if (event.target.__touched__ && event.type.match('mouse')){
      delete event.target.__touched__;
      return;
    }
    return true;
  }

  function createFlowEvent(type) {
    var flow = type == 'over';
    return {
      attach: 'OverflowEvent' in win ? 'overflowchanged' : [],
      condition: function (event, custom) {
        event.flow = type;
        return event.type == (type + 'flow') ||
        ((event.orient === 0 && event.horizontalOverflow == flow) ||
        (event.orient == 1 && event.verticalOverflow == flow) ||
        (event.orient == 2 && event.horizontalOverflow == flow && event.verticalOverflow == flow));
      }
    };
  }

  function writeProperty(key, event, base, desc){
    if (desc) event[key] = base[key];
    else Object.defineProperty(event, key, {
      writable: true,
      enumerable: true,
      value: base[key]
    });
  }

  var skipProps = {};
  for (var z in document.createEvent('CustomEvent')) skipProps[z] = 1;
  function inheritEvent(event, base){
    var desc = Object.getOwnPropertyDescriptor(event, 'target');
    for (var z in base) {
      if (!skipProps[z]) writeProperty(z, event, base, desc);
    }
    event.baseEvent = base;
  }

// Accessors

  function getArgs(attr, value){
    return {
      value: attr.boolean ? '' : value,
      method: attr.boolean && !value ? 'removeAttribute' : 'setAttribute'
    };
  }

  function modAttr(element, attr, name, value){
    var args = getArgs(attr, value);
    element[args.method](name, args.value);
  }

  function syncAttr(element, attr, name, value, method){
    var nodes = attr.property ? [element.xtag[attr.property]] : attr.selector ? xtag.query(element, attr.selector) : [],
        index = nodes.length;
    while (index--) nodes[index][method](name, value);
  }

  function updateView(element, name, value){
    if (element.__view__){
      element.__view__.updateBindingValue(element, name, value);
    }
  }

  function attachProperties(tag, prop, z, accessor, attr, name){
    var key = z.split(':'), type = key[0];
    if (type == 'get') {
      key[0] = prop;
      tag.prototype[prop].get = xtag.applyPseudos(key.join(':'), accessor[z], tag.pseudos);
    }
    else if (type == 'set') {
      key[0] = prop;
      var setter = tag.prototype[prop].set = xtag.applyPseudos(key.join(':'), attr ? function(value){
        this.xtag._skipSet = true;
        if (!this.xtag._skipAttr) modAttr(this, attr, name, value);
        if (this.xtag._skipAttr && attr.skip) delete this.xtag._skipAttr;
        accessor[z].call(this, attr.boolean ? !!value : value);
        updateView(this, name, value);
        delete this.xtag._skipSet;
      } : accessor[z] ? function(value){
        accessor[z].call(this, value);
        updateView(this, name, value);
      } : null, tag.pseudos);

      if (attr) attr.setter = setter;
    }
    else tag.prototype[prop][z] = accessor[z];
  }

  function parseAccessor(tag, prop){
    tag.prototype[prop] = {};
    var accessor = tag.accessors[prop],
        attr = accessor.attribute,
        name = attr && attr.name ? attr.name.toLowerCase() : prop;

    if (attr) {
      attr.key = prop;
      tag.attributes[name] = attr;
    }

    for (var z in accessor) attachProperties(tag, prop, z, accessor, attr, name);

    if (attr) {
      if (!tag.prototype[prop].get) {
        var method = (attr.boolean ? 'has' : 'get') + 'Attribute';
        tag.prototype[prop].get = function(){
          return this[method](name);
        };
      }
      if (!tag.prototype[prop].set) tag.prototype[prop].set = function(value){
        modAttr(this, attr, name, value);
        updateView(this, name, value);
      };
    }
  }

  var readyTags = {},
      tagReady = false;
  function fireReady(name){
    readyTags[name] = (readyTags[name] || []).filter(function(obj){
      return (obj.tags = obj.tags.filter(function(z){
        return z != name && !xtag.tags[z];
      })).length || obj.fn();
    });
  }

  function tagLoad(){
    for (var z in xtag.tags) fireReady(z);
    tagReady = true;
  }

/*** X-Tag Object Definition ***/

  var xtag = {
    tags: {},
    defaultOptions: {
      pseudos: [],
      mixins: [],
      events: {},
      methods: {},
      accessors: {},
      lifecycle: {},
      attributes: {},
      'prototype': {
        xtag: {
          get: function(){
            return this.__xtag__ ? this.__xtag__ : (this.__xtag__ = { data: {} });
          }
        }
      }
    },
    register: function (name, options) {
      var _name;
      if (typeof name == 'string') {
        _name = name.toLowerCase();
      } else {
        return;
      }

      // save prototype for actual object creation below
      var basePrototype = options.prototype;
      delete options.prototype;

      var tag = xtag.tags[_name] = applyMixins(xtag.merge({}, xtag.defaultOptions, options));

      for (var z in tag.events) tag.events[z] = xtag.parseEvent(z, tag.events[z]);
      for (z in tag.lifecycle) tag.lifecycle[z.split(':')[0]] = xtag.applyPseudos(z, tag.lifecycle[z], tag.pseudos);
      for (z in tag.methods) tag.prototype[z.split(':')[0]] = { value: xtag.applyPseudos(z, tag.methods[z], tag.pseudos), enumerable: true };
      for (z in tag.accessors) parseAccessor(tag, z);

      var ready = tag.lifecycle.created || tag.lifecycle.ready;
      tag.prototype.createdCallback = {
        enumerable: true,
        value: function(){
          var element = this;
          xtag.addEvents(this, tag.events);
          tag.mixins.forEach(function(mixin){
            if (xtag.mixins[mixin].events) xtag.addEvents(element, xtag.mixins[mixin].events);
          });
          var output = ready ? ready.apply(this, toArray(arguments)) : null;
          for (var name in tag.attributes) {
            var attr = tag.attributes[name],
                hasAttr = this.hasAttribute(name);
            if (hasAttr || attr.boolean) {
              this[attr.key] = attr.boolean ? hasAttr : this.getAttribute(name);
            }
          }
          tag.pseudos.forEach(function(obj){
            obj.onAdd.call(element, obj);
          });
          return output;
        }
      };

      if (tag.lifecycle.inserted) tag.prototype.enteredViewCallback = { value: tag.lifecycle.inserted, enumerable: true };
      if (tag.lifecycle.removed) tag.prototype.leftDocumentCallback = { value: tag.lifecycle.removed, enumerable: true };
      if (tag.lifecycle.attributeChanged) tag.prototype.attributeChangedCallback = { value: tag.lifecycle.attributeChanged, enumerable: true };

      var setAttribute = tag.prototype.setAttribute || HTMLElement.prototype.setAttribute;
      tag.prototype.setAttribute = {
        writable: true,
        enumberable: true,
        value: function (name, value){
          var attr = tag.attributes[name.toLowerCase()];
          if (!this.xtag._skipAttr) setAttribute.call(this, name, attr && attr.boolean ? '' : value);
          if (attr) {
            if (attr.setter && !this.xtag._skipSet) {
              this.xtag._skipAttr = true;
              attr.setter.call(this, attr.boolean ? true : value);
            }
            value = attr.skip ? attr.boolean ? this.hasAttribute(name) : this.getAttribute(name) : value;
            syncAttr(this, attr, name, attr.boolean ? '' : value, 'setAttribute');
          }
          delete this.xtag._skipAttr;
        }
      };

      var removeAttribute = tag.prototype.removeAttribute || HTMLElement.prototype.removeAttribute;
      tag.prototype.removeAttribute = {
        writable: true,
        enumberable: true,
        value: function (name){
          var attr = tag.attributes[name.toLowerCase()];
          if (!this.xtag._skipAttr) removeAttribute.call(this, name);
          if (attr) {
            if (attr.setter && !this.xtag._skipSet) {
              this.xtag._skipAttr = true;
              attr.setter.call(this, attr.boolean ? false : undefined);
            }
            syncAttr(this, attr, name, undefined, 'removeAttribute');
          }
          delete this.xtag._skipAttr;
        }
      };

      var elementProto = basePrototype ?
            basePrototype :
            options['extends'] ?
            Object.create(doc.createElement(options['extends']).constructor).prototype :
            win.HTMLElement.prototype;

      var definition = {
        'prototype': Object.create(elementProto, tag.prototype)
      };
      if (options['extends']) {
        definition['extends'] = options['extends'];
      }
      var reg = doc.register(_name, definition);
      if (tagReady) fireReady(_name);
      return reg;
    },

    ready: function(names, fn){
      var obj = { tags: toArray(names), fn: fn };
      if (obj.tags.reduce(function(last, name){
        if (xtag.tags[name]) return last;
        (readyTags[name] = readyTags[name] || []).push(obj);
      }, true)) fn();
    },

    /* Exposed Variables */

    mixins: {},
    prefix: prefix,
    touches: {
      active: [],
      changed: []
    },
    captureEvents: ['focus', 'blur', 'scroll', 'underflow', 'overflow', 'overflowchanged', 'DOMMouseScroll'],
    customEvents: {
      overflow: createFlowEvent('over'),
      underflow: createFlowEvent('under'),
      animationstart: {
        attach: [prefix.dom + 'AnimationStart']
      },
      animationend: {
        attach: [prefix.dom + 'AnimationEnd']
      },
      transitionend: {
        attach: [prefix.dom + 'TransitionEnd']
      },
      move: {
        attach: ['mousemove', 'touchmove'],
        condition: touchFilter
      },
      enter: {
        attach: ['mouseover', 'touchenter'],
        condition: touchFilter
      },
      leave: {
        attach: ['mouseout', 'touchleave'],
        condition: touchFilter
      },
      scrollwheel: {
        attach: ['DOMMouseScroll', 'mousewheel'],
        condition: function(event){
          event.delta = event.wheelDelta ? event.wheelDelta / 40 : Math.round(event.detail / 3.5 * -1);
          return true;
        }
      },
      tapstart: {
        observe: {
          mousedown: doc,
          touchstart: doc
        },
        condition: touchFilter
      },
      tapend: {
        observe: {
          mouseup: doc,
          touchend: doc
        },
        condition: touchFilter
      },
      tapmove: {
        attach: ['tapstart', 'dragend', 'touchcancel'],
        condition: function(event, custom){
          switch (event.type) {
            case 'move':  return true;
            case 'dragover':
              var last = custom.lastDrag || {};
              custom.lastDrag = event;
              return (last.pageX != event.pageX && last.pageY != event.pageY) || null;
            case 'tapstart':
              if (!custom.move) {
                custom.current = this;
                custom.move = xtag.addEvents(this, {
                  move: custom.listener,
                  dragover: custom.listener
                });
                custom.tapend = xtag.addEvent(doc, 'tapend', custom.listener);
              }
              break;
            case 'tapend': case 'dragend': case 'touchcancel':
              if (!event.touches.length) {
                if (custom.move) xtag.removeEvents(custom.current , custom.move || {});
                if (custom.tapend) xtag.removeEvent(doc, custom.tapend || {});
                delete custom.lastDrag;
                delete custom.current;
                delete custom.tapend;
                delete custom.move;
              }
          }
        }
      }
    },
    pseudos: {
      __mixin__: {},
      keypass: keypseudo,
      keyfail: keypseudo,
      delegate: { action: delegateAction },
      within: {
        action: delegateAction,
        onAdd: function(pseudo){
          var condition = pseudo.source.condition;
          if (condition) pseudo.source.condition = function(event, custom){
            return xtag.query(this, pseudo.value).filter(function(node){
              return node == event.target || node.contains ? node.contains(event.target) : null;
            })[0] ? condition.call(this, event, custom) : null;
          };
        }
      },
      preventable: {
        action: function (pseudo, event) {
          return !event.defaultPrevented;
        }
      }
    },

    /* UTILITIES */

    clone: clone,
    typeOf: typeOf,
    toArray: toArray,

    wrap: function (original, fn) {
      return function(){
        var args = toArray(arguments),
            output = original.apply(this, args);
        fn.apply(this, args);
        return output;
      };
    },

    merge: function(source, k, v){
      if (typeOf(k) == 'string') return mergeOne(source, k, v);
      for (var i = 1, l = arguments.length; i < l; i++){
        var object = arguments[i];
        for (var key in object) mergeOne(source, key, object[key]);
      }
      return source;
    },

    uid: function(){
      return Math.random().toString(36).substr(2,10);
    },

    /* DOM */

    query: query,

    skipTransition: function(element, fn){
      var prop = prefix.js + 'TransitionProperty';
      element.style[prop] = element.style.transitionProperty = 'none';
      var callback = fn();
      return xtag.requestFrame(function(){
        xtag.requestFrame(function(){
          element.style[prop] = element.style.transitionProperty = '';
          if (callback) xtag.requestFrame(callback);
        });
      });
    },

    requestFrame: (function(){
      var raf = win.requestAnimationFrame ||
                win[prefix.lowercase + 'RequestAnimationFrame'] ||
                function(fn){ return win.setTimeout(fn, 20); };
      return function(fn){ return raf(fn); };
    })(),

    cancelFrame: (function(){
      var cancel = win.cancelAnimationFrame ||
                   win[prefix.lowercase + 'CancelAnimationFrame'] ||
                   win.clearTimeout;
      return function(id){ return cancel(id); };
    })(),

    matchSelector: function (element, selector) {
      return matchSelector.call(element, selector);
    },

    set: function (element, method, value) {
      element[method] = value;
      if (window.CustomElements) CustomElements.upgradeAll(element);
    },

    innerHTML: function(el, html){
      xtag.set(el, 'innerHTML', html);
    },

    hasClass: function (element, klass) {
      return element.className.split(' ').indexOf(klass.trim())>-1;
    },

    addClass: function (element, klass) {
      var list = element.className.trim().split(' ');
      klass.trim().split(' ').forEach(function (name) {
        if (!~list.indexOf(name)) list.push(name);
      });
      element.className = list.join(' ').trim();
      return element;
    },

    removeClass: function (element, klass) {
      var classes = klass.trim().split(' ');
      element.className = element.className.trim().split(' ').filter(function (name) {
        return name && !~classes.indexOf(name);
      }).join(' ');
      return element;
    },

    toggleClass: function (element, klass) {
      return xtag[xtag.hasClass(element, klass) ? 'removeClass' : 'addClass'].call(null, element, klass);
    },

    queryChildren: function (element, selector) {
      var id = element.id,
        guid = element.id = id || 'x_' + xtag.uid(),
        attr = '#' + guid + ' > ';
      selector = attr + (selector + '').replace(',', ',' + attr, 'g');
      var result = element.parentNode.querySelectorAll(selector);
      if (!id) element.removeAttribute('id');
      return toArray(result);
    },

    createFragment: function(content) {
      var frag = doc.createDocumentFragment();
      if (content) {
        var div = frag.appendChild(doc.createElement('div')),
          nodes = toArray(content.nodeName ? arguments : !(div.innerHTML = content) || div.children),
          length = nodes.length,
          index = 0;
        while (index < length) frag.insertBefore(nodes[index++], div);
        frag.removeChild(div);
      }
      return frag;
    },

    manipulate: function(element, fn){
      var next = element.nextSibling,
        parent = element.parentNode,
        frag = doc.createDocumentFragment(),
        returned = fn.call(frag.appendChild(element), frag) || element;
      if (next) parent.insertBefore(returned, next);
      else parent.appendChild(returned);
    },

    /* PSEUDOS */

    applyPseudos: function(key, fn, target, source) {
      var listener = fn,
          pseudos = {};
      if (key.match(':')) {
        var split = key.match(regexPseudoSplit),
            i = split.length;
        while (--i) {
          split[i].replace(regexPseudoReplace, function (match, name, value) {
            if (!xtag.pseudos[name]) throw "pseudo not found: " + name + " " + split;
            var pseudo = pseudos[i] = Object.create(xtag.pseudos[name]);
                pseudo.key = key;
                pseudo.name = name;
                pseudo.value = value;
                pseudo['arguments'] = (value || '').split(',');
                pseudo.action = pseudo.action || trueop;
                pseudo.source = source;
            var last = listener;
            listener = function(){
              var args = toArray(arguments),
                  obj = {
                    key: key,
                    name: name,
                    value: value,
                    source: source,
                    'arguments': pseudo['arguments'],
                    listener: last
                  };
              var output = pseudo.action.apply(this, [obj].concat(args));
              if (output === null || output === false) return output;
              return obj.listener.apply(this, args);
            };
            if (target && pseudo.onAdd) {
              if (target.nodeName) pseudo.onAdd.call(target, pseudo);
              else target.push(pseudo);
            }
          });
        }
      }
      for (var z in pseudos) {
        if (pseudos[z].onCompiled) listener = pseudos[z].onCompiled(listener, pseudos[z]) || listener;
      }
      return listener;
    },

    removePseudos: function(target, pseudos){
      pseudos.forEach(function(obj){
        if (obj.onRemove) obj.onRemove.call(target, obj);
      });
    },

  /*** Events ***/

    parseEvent: function(type, fn) {
      var pseudos = type.split(':'),
          key = pseudos.shift(),
          custom = xtag.customEvents[key],
          event = xtag.merge({
            type: key,
            stack: noop,
            condition: trueop,
            attach: [],
            _attach: [],
            pseudos: '',
            _pseudos: [],
            onAdd: noop,
            onRemove: noop
          }, custom || {});
      event.attach = toArray(event.base || event.attach);
      event.chain = key + (event.pseudos.length ? ':' + event.pseudos : '') + (pseudos.length ? ':' + pseudos.join(':') : '');
      var condition = event.condition;
      event.condition = function(e){
        var t = e.touches, tt = e.targetTouches;
        return condition.apply(this, toArray(arguments));
      };
      var stack = xtag.applyPseudos(event.chain, fn, event._pseudos, event);
      event.stack = function(e){
        var t = e.touches, tt = e.targetTouches;
        var detail = e.detail || {};
        if (!detail.__stack__) return stack.apply(this, toArray(arguments));
        else if (detail.__stack__ == stack) {
          e.stopPropagation();
          e.cancelBubble = true;
          return stack.apply(this, toArray(arguments));
        }
      };
      event.listener = function(e){
        var args = toArray(arguments),
            output = event.condition.apply(this, args.concat([event]));
        if (!output) return output;
        if (e.type != key) {
          xtag.fireEvent(e.target, key, {
            baseEvent: e,
            detail: output !== true && (output.__stack__ = stack) ? output : { __stack__: stack }
          });
        }
        else return event.stack.apply(this, args);
      };
      event.attach.forEach(function(name) {
        event._attach.push(xtag.parseEvent(name, event.listener));
      });
      if (custom && custom.observe && !custom.__observing__) {
        custom.observer = function(e){
          var output = event.condition.apply(this, toArray(arguments).concat([custom]));
          if (!output) return output;
          xtag.fireEvent(e.target, key, {
            baseEvent: e,
            detail: output !== true ? output : {}
          });
        };
        for (var z in custom.observe) xtag.addEvent(custom.observe[z] || document, z, custom.observer, true);
        custom.__observing__ = true;
      }
      return event;
    },

    addEvent: function (element, type, fn, capture) {
      var event = (typeof fn == 'function') ? xtag.parseEvent(type, fn) : fn;
      event._pseudos.forEach(function(obj){
        obj.onAdd.call(element, obj);
      });
      event._attach.forEach(function(obj) {
        xtag.addEvent(element, obj.type, obj);
      });
      event.onAdd.call(element, event, event.listener);
      element.addEventListener(event.type, event.stack, capture || xtag.captureEvents.indexOf(event.type) > -1);
      return event;
    },

    addEvents: function (element, obj) {
      var events = {};
      for (var z in obj) {
        events[z] = xtag.addEvent(element, z, obj[z]);
      }
      return events;
    },

    removeEvent: function (element, type, event) {
      event = event || type;
      event.onRemove.call(element, event, event.listener);
      xtag.removePseudos(element, event._pseudos);
      event._attach.forEach(function(obj) {
        xtag.removeEvent(element, obj);
      });
      element.removeEventListener(event.type, event.stack);
    },

    removeEvents: function(element, obj){
      for (var z in obj) xtag.removeEvent(element, obj[z]);
    },

    fireEvent: function(element, type, options, warn){
      var event = doc.createEvent('CustomEvent');
      options = options || {};
      if (warn) console.warn('fireEvent has been modified');
      event.initCustomEvent(type,
        options.bubbles !== false,
        options.cancelable !== false,
        options.detail
      );
      if (options.baseEvent) inheritEvent(event, options.baseEvent);
      try { element.dispatchEvent(event); }
      catch (e) {
        console.warn('This error may have been caused by a change in the fireEvent method', e);
      }
    },

    addObserver: function(element, type, fn){
      if (!element._records) {
        element._records = { inserted: [], removed: [] };
        if (mutation){
          element._observer = new mutation(function(mutations) {
            parseMutations(element, mutations);
          });
          element._observer.observe(element, {
            subtree: true,
            childList: true,
            attributes: !true,
            characterData: false
          });
        }
        else ['Inserted', 'Removed'].forEach(function(type){
          element.addEventListener('DOMNode' + type, function(event){
            event._mutation = true;
            element._records[type.toLowerCase()].forEach(function(fn){
              fn(event.target, event);
            });
          }, false);
        });
      }
      if (element._records[type].indexOf(fn) == -1) element._records[type].push(fn);
    },

    removeObserver: function(element, type, fn){
      var obj = element._records;
      if (obj && fn){
        obj[type].splice(obj[type].indexOf(fn), 1);
      }
      else{
        obj[type] = [];
      }
    }

  };

/*** Universal Touch ***/

var touching = false,
    touchTarget = null;

doc.addEventListener('mousedown', function(e){
  touching = true;
  touchTarget = e.target;
}, true);

doc.addEventListener('mouseup', function(){
  touching = false;
  touchTarget = null;
}, true);

doc.addEventListener('dragend', function(){
  touching = false;
  touchTarget = null;
}, true);

var UIEventProto = {
  touches: {
    configurable: true,
    get: function(){
      return this.__touches__ ||
        (this.identifier = 0) ||
        (this.__touches__ = touching ? [this] : []);
    }
  },
  targetTouches: {
    configurable: true,
    get: function(){
      return this.__targetTouches__ || (this.__targetTouches__ =
        (touching && this.currentTarget &&
        (this.currentTarget == touchTarget ||
        (this.currentTarget.contains && this.currentTarget.contains(touchTarget)))) ? (this.identifier = 0) || [this] : []);
    }
  },
  changedTouches: {
    configurable: true,
    get: function(){
      return this.__changedTouches__ || (this.identifier = 0) || (this.__changedTouches__ = [this]);
    }
  }
};

for (z in UIEventProto){
  UIEvent.prototype[z] = UIEventProto[z];
  Object.defineProperty(UIEvent.prototype, z, UIEventProto[z]);
}

var touchReset = {
    value: null,
    writable: true,
    configurable: true
  },
  TouchEventProto = {
    touches: touchReset,
    targetTouches: touchReset,
    changedTouches: touchReset
  };

if (win.TouchEvent) {
  for (z in TouchEventProto) {
    var desc = Object.getOwnPropertyDescriptor(win.TouchEvent.prototype, z);
    if (desc) win.TouchEvent.prototype[z] = TouchEventProto[z];
    else Object.defineProperty(win.TouchEvent.prototype, z, TouchEventProto[z]);
  }
}

/*** Custom Event Definitions ***/

  function addTap(el, tap, e){
    if (!el.__tap__) {
      el.__tap__ = { click: e.type == 'mousedown' };
      if (el.__tap__.click) el.addEventListener('click', tap.observer);
      else {
        el.__tap__.scroll = tap.observer.bind(el);
        window.addEventListener('scroll', el.__tap__.scroll, true);
        el.addEventListener('touchmove', tap.observer);
        el.addEventListener('touchcancel', tap.observer);
        el.addEventListener('touchend', tap.observer);
      }
    }
    if (!el.__tap__.click) {
      el.__tap__.x = e.touches[0].pageX;
      el.__tap__.y = e.touches[0].pageY;
    }
  }

  function removeTap(el, tap){
    if (el.__tap__) {
      if (el.__tap__.click) el.removeEventListener('click', tap.observer);
      else {
        window.removeEventListener('scroll', el.__tap__.scroll, true);
        el.removeEventListener('touchmove', tap.observer);
        el.removeEventListener('touchcancel', tap.observer);
        el.removeEventListener('touchend', tap.observer);
      }
      delete el.__tap__;
    }
  }

  function checkTapPosition(el, tap, e){
    var touch = e.changedTouches[0],
        tol = tap.gesture.tolerance;
    if (
      touch.pageX < el.__tap__.x + tol &&
      touch.pageX > el.__tap__.x - tol &&
      touch.pageY < el.__tap__.y + tol &&
      touch.pageY > el.__tap__.y - tol
    ) return true;
  }

  xtag.customEvents.tap = {
    observe: {
      mousedown: document,
      touchstart: document
    },
    gesture: {
      tolerance: 8
    },
    condition: function(e, tap){
      var el = e.target;
      switch (e.type) {
        case 'touchstart':
          if (el.__tap__ && el.__tap__.click) removeTap(el, tap);
          addTap(el, tap, e);
          return;
        case 'mousedown':
          if (!el.__tap__) addTap(el, tap, e);
          return;
        case 'scroll':
        case 'touchcancel':
          removeTap(this, tap);
          return;
        case 'touchmove':
        case 'touchend':
          if (this.__tap__ && !checkTapPosition(this, tap, e)) {
            removeTap(this, tap);
            return;
          }
          return e.type == 'touchend' || null;
        case 'click':
          removeTap(this, tap);
          return true;
      }
    }
  };

  win.xtag = xtag;
  if (typeof define == 'function' && define.amd) define(xtag);

  if (doc.readyState == 'complete') tagLoad();
  else doc.addEventListener(doc.readyState == 'interactive' ? 'readystatechange' : 'DOMContentLoaded', tagLoad);

  doc.addEventListener('WebComponentsReady', function(){
    xtag.fireEvent(doc.body, 'DOMComponentsLoaded');
  });

})();

!function() {
    xtag.register("x-appbar", {lifecycle: {created: function() {
                var a = xtag.queryChildren(this, "header")[0];
                a || (a = document.createElement("header"), this.appendChild(a)), this.xtag.data.header = a, this.subheading = this.subheading
            }},accessors: {heading: {attribute: {},get: function() {
                    return this.xtag.data.header.innerHTML
                },set: function(a) {
                    this.xtag.data.header.innerHTML = a
                }},subheading: {attribute: {},get: function() {
                    return this.getAttribute("subheading") || ""
                },set: function(a) {
                    this.xtag.data.header.setAttribute("subheading", a)
                }}}})
}(), function() {
    function a(a) {
        var b;
        return 0 === a.getUTCHours() ? b = new Date(a.valueOf()) : (b = new Date, b.setUTCHours(0), b.setUTCFullYear(a.getFullYear()), b.setUTCMonth(a.getMonth()), b.setUTCDate(a.getDate())), b.setUTCMinutes(0), b.setUTCSeconds(0), b.setUTCMilliseconds(0), b
    }
    function b(a, b) {
        a.appendChild(b)
    }
    function c(a) {
        return parseInt(a, 10)
    }
    function d(a) {
        var b = c(a);
        return b === a && !isNaN(b) && b >= 0 && 6 >= b
    }
    function e(a) {
        return a instanceof Date && !!a.getTime && !isNaN(a.getTime())
    }
    function f(a) {
        return a && a.isArray ? a.isArray() : "[object Array]" === Object.prototype.toString.call(a)
    }
    function g(a) {
        var b = a.split("."), c = b.shift(), d = document.createElement(c);
        return d[T] = b.join(" "), d
    }
    function h() {
        var a = document.documentElement, b = {left: a.scrollLeft || document.body.scrollLeft || 0,top: a.scrollTop || document.body.scrollTop || 0,width: a.clientWidth,height: a.clientHeight};
        return b.right = b.left + b.width, b.bottom = b.top + b.height, b
    }
    function i(a) {
        var b = a.getBoundingClientRect(), c = h(), d = c.left, e = c.top;
        return {left: b.left + d,right: b.right + d,top: b.top + e,bottom: b.bottom + e,width: b.width,height: b.height}
    }
    function j(a, b) {
        xtag.addClass(a, b)
    }
    function k(a, b) {
        xtag.removeClass(a, b)
    }
    function l(a, b) {
        return xtag.hasClass(a, b)
    }
    function m(a) {
        return a.getUTCFullYear()
    }
    function n(a) {
        return a.getUTCMonth()
    }
    function o(a) {
        return a.getUTCDate()
    }
    function p(a) {
        return a.getUTCDay()
    }
    function q(a, b) {
        var c = a.toString(), d = new Array(b).join("0");
        return (d + c).substr(-b)
    }
    function r(a) {
        return [q(m(a), 4), q(n(a) + 1, 2), q(o(a), 2)].join("-")
    }
    function s(b) {
        if (e(b))
            return b;
        var c = U.exec(b);
        return c ? a(new Date(c[1], c[2] - 1, c[3])) : null
    }
    function t(b) {
        if (e(b))
            return b;
        var c = s(b);
        if (c)
            return c;
        var d = Date.parse(b);
        return isNaN(d) ? null : a(new Date(d))
    }
    function u(a) {
        var b;
        if (f(a))
            b = a.slice(0);
        else {
            if (e(a))
                return [a];
            if (!("string" == typeof a && a.length > 0))
                return null;
            try {
                if (b = JSON.parse(a), !f(b))
                    return console.warn("invalid list of ranges", a), null
            } catch (c) {
                var d = t(a);
                return d ? [d] : (console.warn("unable to parse", a, "as JSON or single date"), null)
            }
        }
        for (var g = 0; g < b.length; g++) {
            var h = b[g];
            if (!e(h))
                if ("string" == typeof h) {
                    var i = t(h);
                    if (!i)
                        return console.warn("unable to parse date", h), null;
                    b[g] = i
                } else {
                    if (!f(h) || 2 !== h.length)
                        return console.warn("invalid range value: ", h), null;
                    var j = t(h[0]);
                    if (!j)
                        return console.warn("unable to parse start date", h[0], "from range", h), null;
                    var k = t(h[1]);
                    if (!k)
                        return console.warn("unable to parse end date", h[1], "from range", h), null;
                    if (j.valueOf() > k.valueOf())
                        return console.warn("invalid range", h, ": start date is after end date"), null;
                    b[g] = [j, k]
                }
        }
        return b
    }
    function v(b, c, d, e) {
        return void 0 === c && (c = m(b)), void 0 === d && (d = n(b)), void 0 === e && (e = o(b)), a(new Date(c, d, e))
    }
    function w(a, b, c, d) {
        return v(a, m(a) + b, n(a) + c, o(a) + d)
    }
    function x(a, b) {
        b = c(b), d(b) || (b = 0);
        for (var e = 0; 7 > e; e++) {
            if (p(a) === b)
                return a;
            a = C(a)
        }
        throw "unable to find week start"
    }
    function y(a, b) {
        b = c(b), d(b) || (b = 6);
        for (var e = 0; 7 > e; e++) {
            if (p(a) === b)
                return a;
            a = B(a)
        }
        throw "unable to find week end"
    }
    function z(b) {
        return b = new Date(b.valueOf()), b.setUTCDate(1), a(b)
    }
    function A(a) {
        return C(w(a, 0, 1, 0))
    }
    function B(a) {
        return w(a, 0, 0, 1)
    }
    function C(a) {
        return w(a, 0, 0, -1)
    }
    function D(a, b) {
        if (b) {
            b = void 0 === b.length ? [b] : b;
            var c = !1;
            return b.forEach(function(b) {
                2 === b.length ? E(b[0], b[1], a) && (c = !0) : r(b) === r(a) && (c = !0)
            }), c
        }
    }
    function E(a, b, c) {
        return r(a) <= r(c) && r(c) <= r(b)
    }
    function F(a) {
        a.sort(function(a, b) {
            var c = e(a) ? a : a[0], d = e(b) ? b : b[0];
            return c.valueOf() - d.valueOf()
        })
    }
    function G(a) {
        var c = g("div.controls"), d = g("span.prev"), e = g("span.next");
        return d.innerHTML = a.prev, e.innerHTML = a.next, b(c, d), b(c, e), c
    }
    function H(a) {
        var b = this;
        a = a || {}, b._span = a.span || 1, b._multiple = a.multiple || !1, b._viewDate = b._sanitizeViewDate(a.view, a.chosen), b._chosenRanges = b._sanitizeChosenRanges(a.chosen, a.view), b._firstWeekdayNum = a.firstWeekdayNum || 0, b._el = g("div.calendar"), b._labels = O(), b._customRenderFn = null, b._renderRecursionFlag = !1, b.render(!0)
    }
    function I(a) {
        a = a.slice(0), F(a);
        for (var b = [], c = 0; c < a.length; c++) {
            var d, f, g, h, i = a[c], j = b.length > 0 ? b[b.length - 1] : null;
            if (e(i) ? d = f = i : (d = i[0], f = i[1]), i = D(d, f) ? d : [d, f], e(j))
                g = h = j;
            else {
                if (!j) {
                    b.push(i);
                    continue
                }
                g = j[0], h = j[1]
            }
            if (D(d, [j]) || D(C(d), [j])) {
                var k = g.valueOf() < d.valueOf() ? g : d, l = h.valueOf() > f.valueOf() ? h : f, m = D(k, l) ? k : [k, l];
                b[b.length - 1] = m
            } else
                b.push(i)
        }
        return b
    }
    function J(a, b) {
        var c, d = b.getAttribute("data-date"), e = t(d);
        l(b, S) ? (a.xtag.dragType = R, c = "datetoggleoff") : (a.xtag.dragType = Q, c = "datetoggleon"), a.xtag.dragStartEl = b, a.xtag.dragAllowTap = !0, a.noToggle || xtag.fireEvent(a, c, {detail: {date: e,iso: d}}), a.setAttribute("active", !0), b.setAttribute("active", !0)
    }
    function K(a, b) {
        var c = b.getAttribute("data-date"), d = t(c);
        b !== a.xtag.dragStartEl && (a.xtag.dragAllowTap = !1), a.noToggle || (a.xtag.dragType !== Q || l(b, S) ? a.xtag.dragType === R && l(b, S) && xtag.fireEvent(a, "datetoggleoff", {detail: {date: d,iso: c}}) : xtag.fireEvent(a, "datetoggleon", {detail: {date: d,iso: c}})), a.xtag.dragType && b.setAttribute("active", !0)
    }
    function L() {
        for (var a = xtag.query(document, "x-calendar"), b = 0; b < a.length; b++) {
            var c = a[b];
            c.xtag.dragType = null, c.xtag.dragStartEl = null, c.xtag.dragAllowTap = !1, c.removeAttribute("active")
        }
        for (var d = xtag.query(document, "x-calendar .day[active]"), e = 0; e < d.length; e++)
            d[e].removeAttribute("active")
    }
    function M(a, b, c) {
        return c.left <= a && a <= c.right && c.top <= b && b <= c.bottom
    }
    var N = 0, O = function() {
        return {prev: "<",next: ">",months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}
    }, P = a(new Date), Q = "add", R = "remove", S = "chosen", T = "className", U = /(\d{4})[^\d]?(\d{2})[^\d]?(\d{2})/, V = H.prototype;
    V.makeMonth = function(a) {
        if (!e(a))
            throw "Invalid view date!";
        var c = this.firstWeekdayNum, d = this.chosen, f = this.labels, h = n(a), i = x(z(a), c), k = g("div.month"), l = g("div.month-label");
        l.textContent = f.months[h] + " " + m(a), b(k, l);
        for (var p = g("div.weekday-labels"), q = 0; 7 > q; q++) {
            var s = (c + q) % 7, t = g("span.weekday-label");
            t.textContent = f.weekdays[s], b(p, t)
        }
        b(k, p);
        var u = g("div.week"), v = i, w = 42;
        for (q = 0; w > q; q++) {
            var y = g("span.day");
            if (y.setAttribute("data-date", r(v)), y.textContent = o(v), n(v) !== h && j(y, "badmonth"), D(v, d) && j(y, S), D(v, P) && j(y, "today"), b(u, y), v = B(v), 0 === (q + 1) % 7) {
                b(k, u), u = g("div.week");
                var A = n(v) > h || n(v) < h && m(v) > m(i);
                if (A)
                    break
            }
        }
        return k
    }, V._sanitizeViewDate = function(a, b) {
        b = void 0 === b ? this.chosen : b;
        var c;
        if (e(a))
            c = a;
        else if (e(b))
            c = b;
        else if (f(b) && b.length > 0) {
            var d = b[0];
            c = e(d) ? d : d[0]
        } else
            c = P;
        return c
    }, V._sanitizeChosenRanges = function(a, b) {
        b = void 0 === b ? this.view : b;
        var c;
        c = e(a) ? [a] : f(a) ? a : null !== a && void 0 !== a && b ? [b] : [];
        var d = I(c);
        if (!this.multiple && d.length > 0) {
            var g = d[0];
            return e(g) ? [g] : [g[0]]
        }
        return d
    }, V.addDate = function(a, b) {
        e(a) && (b ? (this.chosen.push(a), this.chosen = this.chosen) : this.chosen = [a])
    }, V.removeDate = function(a) {
        if (e(a))
            for (var b = this.chosen.slice(0), c = 0; c < b.length; c++) {
                var d = b[c];
                if (D(a, [d])) {
                    if (b.splice(c, 1), f(d)) {
                        var g = d[0], h = d[1], i = C(a), j = B(a);
                        D(i, [d]) && b.push([g, i]), D(j, [d]) && b.push([j, h])
                    }
                    this.chosen = I(b);
                    break
                }
            }
    }, V.hasChosenDate = function(a) {
        return D(a, this._chosenRanges)
    }, V.hasVisibleDate = function(a, b) {
        var c = b ? this.firstVisibleMonth : this.firstVisibleDate, d = b ? A(this.lastVisibleMonth) : this.lastVisibleDate;
        return D(a, [[c, d]])
    }, V.render = function(a) {
        var c, d = this._span;
        if (a) {
            var e, f = xtag.query(this.el, ".day");
            for (c = 0; c < f.length; c++)
                if (e = f[c], e.hasAttribute("data-date")) {
                    var g = e.getAttribute("data-date"), h = s(g);
                    h && (D(h, this._chosenRanges) ? j(e, S) : k(e, S), D(h, [P]) ? j(e, "today") : k(e, "today"))
                }
        } else {
            this.el.innerHTML = "";
            var i = this.firstVisibleMonth;
            for (c = 0; d > c; c++)
                b(this.el, this.makeMonth(i)), i = w(i, 0, 1, 0)
        }
        this._callCustomRenderer()
    }, V._callCustomRenderer = function() {
        if (this._customRenderFn) {
            if (this._renderRecursionFlag)
                throw "Error: customRenderFn causes recursive loop of rendering calendar; make sure your custom rendering function doesn't modify attributes of the x-calendar that would require a re-render!";
            for (var a = xtag.query(this.el, ".day"), b = 0; b < a.length; b++) {
                var c = a[b], d = c.getAttribute("data-date"), e = s(d);
                this._renderRecursionFlag = !0, this._customRenderFn(c, e ? e : null, d), this._renderRecursionFlag = !1
            }
        }
    }, Object.defineProperties(V, {el: {get: function() {
                return this._el
            }},multiple: {get: function() {
                return this._multiple
            },set: function(a) {
                this._multiple = a, this.chosen = this._sanitizeChosenRanges(this.chosen), this.render(!0)
            }},span: {get: function() {
                return this._span
            },set: function(a) {
                var b = c(a);
                this._span = !isNaN(b) && b >= 0 ? b : 0, this.render(!1)
            }},view: {attribute: {},get: function() {
                return this._viewDate
            },set: function(a) {
                var b = this._sanitizeViewDate(a), c = this._viewDate;
                this._viewDate = b, this.render(n(c) === n(b) && m(c) === m(b))
            }},chosen: {get: function() {
                return this._chosenRanges
            },set: function(a) {
                this._chosenRanges = this._sanitizeChosenRanges(a), this.render(!0)
            }},firstWeekdayNum: {get: function() {
                return this._firstWeekdayNum
            },set: function(a) {
                a = c(a), d(a) || (a = 0), this._firstWeekdayNum = a, this.render(!1)
            }},lastWeekdayNum: {get: function() {
                return (this._firstWeekdayNum + 6) % 7
            }},customRenderFn: {get: function() {
                return this._customRenderFn
            },set: function(a) {
                this._customRenderFn = a, this.render(!0)
            }},chosenString: {get: function() {
                if (this.multiple) {
                    for (var a = this.chosen.slice(0), b = 0; b < a.length; b++) {
                        var c = a[b];
                        a[b] = e(c) ? r(c) : [r(c[0]), r(c[1])]
                    }
                    return JSON.stringify(a)
                }
                return this.chosen.length > 0 ? r(this.chosen[0]) : ""
            }},firstVisibleMonth: {get: function() {
                return z(w(this.view, 0, -Math.floor(this.span / 2), 0))
            }},lastVisibleMonth: {get: function() {
                return w(this.firstVisibleMonth, 0, Math.max(0, this.span - 1), 0)
            }},firstVisibleDate: {get: function() {
                return x(this.firstVisibleMonth, this.firstWeekdayNum)
            }},lastVisibleDate: {get: function() {
                return y(A(this.lastVisibleMonth), this.lastWeekdayNum)
            }},labels: {get: function() {
                return this._labels
            },set: function(a) {
                var b = this.labels;
                for (var c in b)
                    if (c in a) {
                        var d = this._labels[c], e = a[c];
                        if (f(d)) {
                            if (!f(e) || d.length !== e.length)
                                throw "invalid label given for '" + c + "': expected array of " + d.length + " labels, got " + JSON.stringify(e);
                            e = e.slice(0);
                            for (var g = 0; g < e.length; g++)
                                e[g] = e[g].toString ? e[g].toString() : String(e[g])
                        } else
                            e = String(e);
                        b[c] = e
                    }
                this.render(!1)
            }}});
    var W = null, X = null;
    xtag.register("x-calendar", {lifecycle: {created: function() {
                this.innerHTML = "";
                var a = this.getAttribute("chosen");
                this.xtag.calObj = new H({span: this.getAttribute("span"),view: t(this.getAttribute("view")),chosen: u(a),multiple: this.hasAttribute("multiple"),firstWeekdayNum: this.getAttribute("first-weekday-num")}), b(this, this.xtag.calObj.el), this.xtag.calControls = null, this.xtag.dragType = null, this.xtag.dragStartEl = null, this.xtag.dragAllowTap = !1
            },inserted: function() {
                W || (W = xtag.addEvent(document, "mouseup", L)), X || (X = xtag.addEvent(document, "touchend", L)), this.render(!1)
            },removed: function() {
                0 === xtag.query(document, "x-calendar").length && (W && (xtag.removeEvent(document, "mouseup", W), W = null), X && (xtag.removeEvent(document, "touchend", X), X = null))
            }},events: {"tap:delegate(.next)": function(a) {
                var b = a.currentTarget;
                b.nextMonth(), xtag.fireEvent(b, "nextmonth")
            },"tap:delegate(.prev)": function(a) {
                var b = a.currentTarget;
                b.prevMonth(), xtag.fireEvent(b, "prevmonth")
            },"tapstart:delegate(.day)": function(a) {
                (a.touches || !a.button || a.button === N) && (a.preventDefault(), a.baseEvent && a.baseEvent.preventDefault(), J(a.currentTarget, this))
            },touchmove: function(a) {
                if (a.touches && a.touches.length > 0) {
                    var b = a.currentTarget;
                    if (b.xtag.dragType)
                        for (var c = a.touches[0], d = xtag.query(b, ".day"), e = 0; e < d.length; e++) {
                            var f = d[e];
                            M(c.pageX, c.pageY, i(f)) ? K(b, f) : f.removeAttribute("active")
                        }
                }
            },"mouseover:delegate(.day)": function(a) {
                var b = a.currentTarget, c = this;
                K(b, c)
            },"mouseout:delegate(.day)": function() {
                var a = this;
                a.removeAttribute("active")
            },"tapend:delegate(.day)": function(a) {
                var b = a.currentTarget;
                if (b.xtag.dragAllowTap) {
                    var c = this, d = c.getAttribute("data-date"), e = t(d);
                    xtag.fireEvent(b, "datetap", {detail: {date: e,iso: d}})
                }
            },datetoggleon: function(a) {
                var b = this;
                b.toggleDateOn(a.detail.date, b.multiple)
            },datetoggleoff: function(a) {
                var b = this;
                b.toggleDateOff(a.detail.date)
            }},accessors: {controls: {attribute: {"boolean": !0},set: function(a) {
                    a && !this.xtag.calControls && (this.xtag.calControls = G(this.xtag.calObj.labels), b(this, this.xtag.calControls))
                }},multiple: {attribute: {"boolean": !0},get: function() {
                    return this.xtag.calObj.multiple
                },set: function(a) {
                    this.xtag.calObj.multiple = a, this.chosen = this.chosen
                }},span: {attribute: {},get: function() {
                    return this.xtag.calObj.span
                },set: function(a) {
                    this.xtag.calObj.span = a
                }},view: {attribute: {},get: function() {
                    return this.xtag.calObj.view
                },set: function(a) {
                    var b = t(a);
                    b && (this.xtag.calObj.view = b)
                }},chosen: {attribute: {skip: !0},get: function() {
                    var a = this.xtag.calObj.chosen;
                    if (this.multiple)
                        return this.xtag.calObj.chosen;
                    if (a.length > 0) {
                        var b = a[0];
                        return e(b) ? b : b[0]
                    }
                    return null
                },set: function(a) {
                    var b = this.multiple ? u(a) : t(a);
                    this.xtag.calObj.chosen = b ? b : null, this.xtag.calObj.chosenString ? this.setAttribute("chosen", this.xtag.calObj.chosenString) : this.removeAttribute("chosen")
                }},firstWeekdayNum: {attribute: {name: "first-weekday-num"},set: function(a) {
                    this.xtag.calObj.firstWeekdayNum = a
                }},noToggle: {attribute: {"boolean": !0,name: "notoggle"},set: function(a) {
                    a && (this.chosen = null)
                }},firstVisibleMonth: {get: function() {
                    return this.xtag.calObj.firstVisibleMonth
                }},lastVisibleMonth: {get: function() {
                    return this.xtag.calObj.lastVisibleMonth
                }},firstVisibleDate: {get: function() {
                    return this.xtag.calObj.firstVisibleDate
                }},lastVisibleDate: {get: function() {
                    return this.xtag.calObj.lastVisibleDate
                }},customRenderFn: {get: function() {
                    return this.xtag.calObj.customRenderFn
                },set: function(a) {
                    this.xtag.calObj.customRenderFn = a
                }},labels: {get: function() {
                    return JSON.parse(JSON.stringify(this.xtag.calObj.labels))
                },set: function(a) {
                    this.xtag.calObj.labels = a;
                    var b = this.xtag.calObj.labels, c = this.querySelector(".controls > .prev");
                    c && (c.textContent = b.prev);
                    var d = this.querySelector(".controls > .next");
                    d && (d.textContent = b.next)
                }}},methods: {render: function(a) {
                this.xtag.calObj.render(a)
            },prevMonth: function() {
                var a = this.xtag.calObj;
                a.view = w(a.view, 0, -1, 0)
            },nextMonth: function() {
                var a = this.xtag.calObj;
                a.view = w(a.view, 0, 1, 0)
            },toggleDateOn: function(a, b) {
                this.xtag.calObj.addDate(a, b), this.chosen = this.chosen
            },toggleDateOff: function(a) {
                this.xtag.calObj.removeDate(a), this.chosen = this.chosen
            },toggleDate: function(a, b) {
                this.xtag.calObj.hasChosenDate(a) ? this.toggleDateOff(a) : this.toggleDateOn(a, b)
            },hasVisibleDate: function(a, b) {
                return this.xtag.calObj.hasVisibleDate(a, b)
            }}})
}(), function() {
    function a(a) {
        return JSON.parse(JSON.stringify(a))
    }
    function b(a) {
        var b;
        return 0 === a.getUTCHours() ? b = new Date(a.valueOf()) : (b = new Date, b.setUTCHours(0), b.setUTCFullYear(a.getFullYear()), b.setUTCMonth(a.getMonth()), b.setUTCDate(a.getDate())), b.setUTCMinutes(0), b.setUTCSeconds(0), b.setUTCMilliseconds(0), b
    }
    function c(a) {
        return a instanceof Date && !!a.getTime && !isNaN(a.getTime())
    }
    function d(a) {
        return a.getUTCFullYear()
    }
    function e(a) {
        return a.getUTCMonth()
    }
    function f(a) {
        return a.getUTCDate()
    }
    function g(a, b) {
        var c = a.toString(), d = new Array(b).join("0");
        return (d + c).substr(-b)
    }
    function h(a) {
        return [g(d(a), 4), g(e(a) + 1, 2), g(f(a), 2)].join("-")
    }
    function i(a) {
        if (c(a))
            return a;
        var d = q.exec(a);
        return d ? b(new Date(d[1], d[2] - 1, d[3])) : null
    }
    function j(a) {
        if (c(a))
            return a;
        var d = i(a);
        if (d)
            return d;
        var e = Date.parse(a);
        return isNaN(e) ? null : b(new Date(e))
    }
    function k(a) {
        var b = a.polyfill ? a.xtag.polyfillInput : a.xtag.dateInput, c = j(b.value);
        return c ? a.removeAttribute("invalid") : a.setAttribute("invalid", !0), !!c
    }
    function l(a, b) {
        var c = a.polyfill ? a.xtag.polyfillInput : a.xtag.dateInput, d = c.value, e = j(d);
        a.value = b && e ? e : d
    }
    function m(a, b, c) {
        var d = a.submitValue, e = a.value;
        b();
        var f = a.submitValue, g = a.value;
        (d !== f || c && e !== g) && xtag.fireEvent(a, "change")
    }
    function n(a) {
        var b = a.xtag._labels;
        return new Array(5).join(b.yearAbbr) + "-" + new Array(3).join(b.monthAbbr) + "-" + new Array(3).join(b.dayAbbr)
    }
    var o = 13, p = document.createElement("x-calendar").labels, q = /(\d{4})[^\d]?(\d{2})[^\d]?(\d{2})/;
    xtag.register("x-datepicker", {lifecycle: {created: function() {
                this.innerHTML = "";
                var b = document.createElement("input");
                b.setAttribute("type", "date"), xtag.addClass(b, "x-datepicker-input"), this.appendChild(b), this.xtag.dateInput = b, this.xtag._labels = {yearAbbr: "Y",monthAbbr: "M",dayAbbr: "D"}, this.xtag._polyfillCalLabels = a(p), this.xtag.polyfillInput = null, this.xtag.polyfillUI = null, this.polyfill = this.hasAttribute("polyfill") || "date" !== b.type.toLowerCase()
            }},events: {"datetoggleon:delegate(x-calendar)": function(a) {
                var b = a.currentTarget;
                if (a.detail && a.detail.date) {
                    var c = j(a.detail.date);
                    m(b, function() {
                        b.value = c ? h(c) : "", xtag.fireEvent(b, "input")
                    })
                }
            },"datetoggleoff:delegate(x-calendar)": function(a) {
                a.currentTarget.value = null
            },focus: function(a) {
                a.currentTarget.setAttribute("focused", !0)
            },"blur:delegate(.x-datepicker-input)": function(a) {
                a.currentTarget.removeAttribute("focused")
            },"blur:delegate(.x-datepicker-polyfill-input)": function(a) {
                var b = a.currentTarget;
                b.removeAttribute("focused"), m(b, function() {
                    l(b, !0)
                }, !0)
            },"touchstart:delegate(.x-datepicker-polyfill-input)": function() {
                this.setAttribute("readonly", !0)
            },"tapstart:delegate(x-calendar)": function(a) {
                a.preventDefault(), a.baseEvent && a.baseEvent.preventDefault()
            },"keypress:delegate(.x-datepicker-polyfill-input)": function(a) {
                var b = a.keyCode, c = a.currentTarget;
                b === o && m(c, function() {
                    l(c, !0)
                }, !0)
            },"input:delegate(.x-datepicker-input)": function(a) {
                var b = a.currentTarget;
                m(b, function() {
                    l(b, !0), a.stopPropagation(), xtag.fireEvent(b, "input")
                })
            },"input:delegate(.x-datepicker-polyfill-input)": function(a) {
                var b = a.currentTarget;
                m(b, function() {
                    l(b, !1), a.stopPropagation(), xtag.fireEvent(b, "input")
                })
            },"change:delegate(.x-datepicker-input)": function(a) {
                a.stopPropagation(), xtag.fireEvent(a.currentTarget, "change")
            },"change:delegate(.x-datepicker-polyfill-input)": function(a) {
                a.stopPropagation();
                var b = a.currentTarget;
                m(b, function() {
                    l(b, !1)
                })
            }},accessors: {name: {attribute: {selector: ".x-datepicker-input"},set: function(a) {
                    var b = this.xtag.dateInput;
                    null === a || void 0 === a ? b.removeAttribute("name") : b.setAttribute("name", a)
                }},submitValue: {get: function() {
                    return this.xtag.dateInput.value
                }},value: {attribute: {skip: !0},get: function() {
                    return this.polyfill ? this.xtag.polyfillInput.value : this.xtag.dateInput.value
                },set: function(a) {
                    var b = j(a), c = b ? h(b) : null, d = this.xtag.dateInput, e = this.xtag.polyfillInput, f = this.xtag.polyfillUI;
                    if (null === a || void 0 === a)
                        this.removeAttribute("value"), d.value = "", e && (e.value = ""), f && (f.chosen = null);
                    else {
                        var g, i = c ? c : a;
                        e ? a !== e.value ? (e.value = i, g = i) : g = a : g = i, this.setAttribute("value", g), c ? (d.value = c, f && (f.chosen = b, f.view = b)) : (d.value = "", f && (f.chosen = null))
                    }
                    k(this)
                }},polyfill: {attribute: {"boolean": !0},set: function(a) {
                    var b = this.xtag.dateInput;
                    if (a) {
                        if (b.setAttribute("type", "hidden"), b.setAttribute("readonly", !0), !this.xtag.polyfillInput) {
                            var c = document.createElement("input");
                            xtag.addClass(c, "x-datepicker-polyfill-input"), c.setAttribute("type", "text"), c.setAttribute("placeholder", n(this)), c.value = this.xtag.dateInput.value, this.xtag.polyfillInput = c, this.appendChild(c)
                        }
                        if (this.xtag.polyfillInput.removeAttribute("disabled"), !this.xtag.polyfillUI) {
                            var d = document.createElement("x-calendar");
                            xtag.addClass(d, "x-datepicker-polyfill-ui"), d.chosen = this.value, d.view = this.xtag.dateInput.value, d.controls = !0, d.labels = this.xtag._polyfillCalLabels, this.xtag.polyfillUI = d, this.appendChild(d)
                        }
                    } else {
                        "date" !== b.getAttribute("type") && b.setAttribute("type", "date"), b.removeAttribute("readonly");
                        var e = this.xtag.polyfillInput;
                        e && e.setAttribute("disabled", !0)
                    }
                }},labels: {get: function() {
                    var b = {}, c = this.xtag._labels, d = this.xtag._polyfillCalLabels;
                    for (var e in c)
                        b[e] = c[e];
                    for (e in d)
                        b[e] = d[e];
                    return a(b)
                },set: function(a) {
                    var b = this.xtag.polyfillUI, c = this.xtag.polyfillInput, d = null;
                    if (b)
                        b.labels = a, this.xtag._polyfillCalLabels = b.labels;
                    else {
                        var e = this.xtag._polyfillCalLabels;
                        for (d in e)
                            d in a && (e[d] = a[d])
                    }
                    var f = this.xtag._labels;
                    for (d in f)
                        d in a && (f[d] = a[d]);
                    c && c.setAttribute("placeholder", n(this))
                }}}})
}(), function() {
    function a(a, b) {
        this._historyStack = [], this.currIndex = -1, this._itemCap = void 0, this.itemCap = b, this._validatorFn = a ? a : function() {
            return !0
        }
    }
    function b(a) {
        var b = window.getComputedStyle(a), c = xtag.prefix.js + "TransitionDuration";
        return b.transitionDuration ? b.transitionDuration : b[c]
    }
    function c(a) {
        if ("string" != typeof a)
            return 0;
        var b = /^(\d*\.?\d+)(m?s)$/, c = a.toLowerCase().match(b);
        if (c) {
            var d = c[1], e = c[2], f = parseFloat(d);
            if (isNaN(f))
                throw "value error";
            if ("s" === e)
                return 1e3 * f;
            if ("ms" === e)
                return f;
            throw "unit error"
        }
        return 0
    }
    function d(a, b) {
        return (a % b + b) % b
    }
    function e(a) {
        return xtag.queryChildren(a, "x-card")
    }
    function f(a, b) {
        var c = e(a);
        return isNaN(parseInt(b, 10)) || 0 > b || b >= c.length ? null : c[b]
    }
    function g(a, b) {
        var c = e(a);
        return c.indexOf(b)
    }
    function h(a, d, f, h, i) {
        a.xtag._selectedCard = f;
        var j = new Date;
        a.xtag._lastAnimTimestamp = j;
        var m = function() {
            j === a.xtag._lastAnimTimestamp && (k(a), xtag.fireEvent(a, "shuffleend", {detail: {oldCard: d,newCard: f}}))
        };
        if (f === d)
            return m(), void 0;
        var n = !1, o = !1, p = !1, q = function() {
            n && o && (e(a).forEach(function(a) {
                a.removeAttribute("selected"), a.removeAttribute("leaving")
            }), d.setAttribute("leaving", !0), f.setAttribute("selected", !0), a.xtag._selectedCard = f, a.selectedIndex = g(a, f), i && (d.setAttribute("reverse", !0), f.setAttribute("reverse", !0)), xtag.fireEvent(a, "shufflestart", {detail: {oldCard: d,newCard: f}}))
        }, r = function() {
            p || n && o && s()
        }, s = function() {
            p = !0;
            var a = !1, e = !1, g = !1, i = function(b) {
                g || (b.target === d ? (a = !0, d.removeEventListener("transitionend", i)) : b.target === f && (e = !0, f.removeEventListener("transitionend", i)), a && e && (g = !0, m()))
            };
            d.addEventListener("transitionend", i), f.addEventListener("transitionend", i);
            var j = c(b(d)), k = c(b(f)), n = Math.max(j, k), o = 1.15, q = "none" === h.toLowerCase() ? 0 : Math.ceil(n * o);
            0 === q ? (g = !0, d.removeEventListener("transitionend", i), f.removeEventListener("transitionend", i), d.removeAttribute(l), f.removeAttribute(l), m()) : (d.removeAttribute(l), f.removeAttribute(l), window.setTimeout(function() {
                g || (g = !0, d.removeEventListener("transitionend", i), f.removeEventListener("transitionend", i), m())
            }, q))
        };
        xtag.skipTransition(d, function() {
            return d.setAttribute("card-anim-type", h), d.setAttribute(l, !0), n = !0, q(), r
        }, this), xtag.skipTransition(f, function() {
            return f.setAttribute("card-anim-type", h), f.setAttribute(l, !0), o = !0, q(), r
        }, this)
    }
    function i(a, b, c, d, f) {
        var g = a.xtag._selectedCard;
        if (g === b) {
            var i = {detail: {oldCard: g,newCard: b}};
            return xtag.fireEvent(a, "shufflestart", i), xtag.fireEvent(a, "shuffleend", i), void 0
        }
        k(a), void 0 === c && (console.log("defaulting to none transition"), c = "none");
        var j;
        switch (d) {
            case "forward":
                j = !1;
                break;
            case "reverse":
                j = !0;
                break;
            default:
                g || (j = !1);
                var l = e(a);
                j = l.indexOf(b) < l.indexOf(g) ? !0 : !1
        }
        b.hasAttribute("transition-override") && (c = b.getAttribute("transition-override")), f || a.xtag.history.pushState(b), h(a, g, b, c, j)
    }
    function j(a, b, c, d) {
        var e = f(a, b);
        if (!e)
            throw "no card at index " + b;
        i(a, e, c, d)
    }
    function k(a) {
        if (a.xtag._initialized) {
            var b = e(a), c = a.xtag._selectedCard;
            c && c.parentNode === a || (c = b.length > 0 ? a.xtag.history && a.xtag.history.numStates > 0 ? a.xtag.history.currState : b[0] : null), b.forEach(function(a) {
                a.removeAttribute("leaving"), a.removeAttribute(l), a.removeAttribute("card-anim-type"), a.removeAttribute("reverse"), a !== c ? a.removeAttribute("selected") : a.setAttribute("selected", !0)
            }), a.xtag._selectedCard = c, a.selectedIndex = g(a, c)
        }
    }
    var l = "_before-animation", m = a.prototype;
    m.pushState = function(a) {
        if (this.canRedo && this._historyStack.splice(this.currIndex + 1, this._historyStack.length - (this.currIndex + 1)), this._historyStack.push(a), this.currIndex = this._historyStack.length - 1, this.sanitizeStack(), "none" !== this._itemCap && this._historyStack.length > this._itemCap) {
            var b = this._historyStack.length;
            this._historyStack.splice(0, b - this._itemCap), this.currIndex = this._historyStack.length - 1
        }
    }, m.sanitizeStack = function() {
        for (var a, b = this._validatorFn, c = 0; c < this._historyStack.length; ) {
            var d = this._historyStack[c];
            d !== a && b(d) ? (a = d, c++) : (this._historyStack.splice(c, 1), c <= this.currIndex && this.currIndex--)
        }
    }, m.forwards = function() {
        this.canRedo && this.currIndex++, this.sanitizeStack()
    }, m.backwards = function() {
        this.canUndo && this.currIndex--, this.sanitizeStack()
    }, Object.defineProperties(m, {DEFAULT_CAP: {value: 10},itemCap: {get: function() {
                return this._itemCap
            },set: function(a) {
                if (void 0 === a)
                    this._itemCap = this.DEFAULT_CAP;
                else if ("none" === a)
                    this._itemCap = "none";
                else {
                    var b = parseInt(a, 10);
                    if (isNaN(a) || 0 >= a)
                        throw "attempted to set invalid item cap: " + a;
                    this._itemCap = b
                }
            }},canUndo: {get: function() {
                return this.currIndex > 0
            }},canRedo: {get: function() {
                return this.currIndex < this._historyStack.length - 1
            }},numStates: {get: function() {
                return this._historyStack.length
            }},currState: {get: function() {
                var a = this.currIndex;
                return a >= 0 && a < this._historyStack.length ? this._historyStack[a] : null
            }}}), xtag.register("x-deck", {lifecycle: {created: function() {
                var b = this;
                b.xtag._initialized = !0;
                var c = function(a) {
                    return a.parentNode === b
                };
                b.xtag.history = new a(c, a.DEFAULT_CAP), b.xtag._selectedCard = b.xtag._selectedCard ? b.xtag._selectedCard : null, b.xtag._lastAnimTimestamp = null, b.xtag.transitionType = "scrollLeft";
                var d = b.getCardAt(b.getAttribute("selected-index"));
                d && (b.xtag._selectedCard = d), k(b);
                var e = b.xtag._selectedCard;
                e && b.xtag.history.pushState(e)
            }},events: {"show:delegate(x-card)": function() {
                var a = this;
                a.show()
            }},accessors: {transitionType: {attribute: {name: "transition-type"},get: function() {
                    return this.xtag.transitionType
                },set: function(a) {
                    this.xtag.transitionType = a
                }},selectedIndex: {attribute: {skip: !0,name: "selected-index"},get: function() {
                    return g(this, this.xtag._selectedCard)
                },set: function(a) {
                    this.selectedIndex !== a && j(this, a, "none"), this.setAttribute("selected-index", a)
                }},historyCap: {attribute: {name: "history-cap"},get: function() {
                    return this.xtag.history.itemCap
                },set: function(a) {
                    this.xtag.history.itemCap = a
                }},numCards: {get: function() {
                    return this.getAllCards().length
                }},currHistorySize: {get: function() {
                    return this.xtag.history.numStates
                }},currHistoryIndex: {get: function() {
                    return this.xtag.history.currIndex
                }},cards: {get: function() {
                    return this.getAllCards()
                }},selectedCard: {get: function() {
                    return this.getSelectedCard()
                }}},methods: {shuffleTo: function(a, b) {
                var c = f(this, a);
                if (!c)
                    throw "invalid shuffleTo index " + a;
                var d = this.xtag.transitionType;
                j(this, a, d, b)
            },shuffleNext: function(a) {
                a = a ? a : "auto";
                var b = e(this), c = this.xtag._selectedCard, f = b.indexOf(c);
                f > -1 && this.shuffleTo(d(f + 1, b.length), a)
            },shufflePrev: function(a) {
                a = a ? a : "auto";
                var b = e(this), c = this.xtag._selectedCard, f = b.indexOf(c);
                f > -1 && this.shuffleTo(d(f - 1, b.length), a)
            },getAllCards: function() {
                return e(this)
            },getSelectedCard: function() {
                return this.xtag._selectedCard
            },getCardIndex: function(a) {
                return g(this, a)
            },getCardAt: function(a) {
                return f(this, a)
            },historyBack: function(a) {
                var b = this.xtag.history;
                if (b.canUndo) {
                    b.backwards();
                    var c = b.currState;
                    c && i(this, c, this.transitionType, a, !0)
                }
            },historyForward: function(a) {
                var b = this.xtag.history;
                if (b.canRedo) {
                    b.forwards();
                    var c = b.currState;
                    c && i(this, c, this.transitionType, a, !0)
                }
            }}}), xtag.register("x-card", {lifecycle: {inserted: function() {
                var a = this, b = a.parentNode;
                b && "x-deck" === b.tagName.toLowerCase() && (k(b), a.xtag.parentDeck = b, xtag.fireEvent(b, "cardadd", {detail: {card: a}}))
            },created: function() {
                var a = this.parentNode;
                a && "x-deck" === a.tagName.toLowerCase() && (this.xtag.parentDeck = a)
            },removed: function() {
                var a = this;
                if (a.xtag.parentDeck) {
                    var b = a.xtag.parentDeck;
                    b.xtag.history.sanitizeStack(), k(b), xtag.fireEvent(b, "cardremove", {detail: {card: a}})
                }
            }},accessors: {transitionOverride: {attribute: {name: "transition-override"}}},methods: {show: function() {
                var a = this.parentNode;
                a === this.xtag.parentDeck && a.shuffleTo(a.getCardIndex(this))
            }}})
}(), function() {
    xtag.register("x-flipbox", {lifecycle: {created: function() {
                this.firstElementChild && xtag.skipTransition(this.firstElementChild, function() {
                }), this.lastElementChild && xtag.skipTransition(this.lastElementChild, function() {
                }), this.hasAttribute("direction") || (this.xtag._direction = "right")
            }},events: {"transitionend:delegate(*:first-child)": function(a) {
                var b = a.target, c = b.parentNode;
                "x-flipbox" === c.nodeName.toLowerCase() && xtag.fireEvent(c, "flipend")
            },"show:delegate(*:first-child)": function(a) {
                var b = a.target, c = b.parentNode;
                "x-flipbox" === c.nodeName.toLowerCase() && (c.flipped = !1)
            },"show:delegate(*:last-child)": function(a) {
                var b = a.target, c = b.parentNode;
                "x-flipbox" === c.nodeName.toLowerCase() && (c.flipped = !0)
            }},accessors: {direction: {attribute: {},get: function() {
                    return this.xtag._direction
                },set: function(a) {
                    xtag.skipTransition(this.firstElementChild, function() {
                        this.setAttribute("_anim-direction", a)
                    }, this), xtag.skipTransition(this.lastElementChild, function() {
                        this.setAttribute("_anim-direction", a)
                    }, this), this.xtag._direction = a
                }},flipped: {attribute: {"boolean": !0}}},methods: {toggle: function() {
                this.flipped = !this.flipped
            },showFront: function() {
                this.flipped = !1
            },showBack: function() {
                this.flipped = !0
            }}})
}(), function() {
    function a(a, b) {
        a.xtag.iconEl.nodeName === g ? (b = void 0 !== b ? b : a.xtag.iconEl.src, b || (a.xtag.iconEl.src = f), a.xtag.iconEl.style.display = b && b !== f ? "" : "none") : a.xtag.iconEl.style.display = a.xtag.iconEl.innerHTML ? "" : "none", a.xtag.contentEl.style.display = a.xtag.contentEl.innerHTML ? "" : "none"
    }
    function b(a) {
        var b = a.xtag.iconEl, c = a.xtag.contentEl;
        if (c && b) {
            var d = b.parentNode;
            if (!d || c.parentNode !== d)
                throw "invalid parent node of iconbutton's icon / label";
            switch (a.iconAnchor) {
                case "right":
                case "bottom":
                    d.insertBefore(c, b);
                    break;
                default:
                    d.insertBefore(b, c)
            }
        }
    }
    function c() {
        xtag.query(document, "x-iconbutton[active]").forEach(function(a) {
            a.removeAttribute("active")
        })
    }
    function d() {
        xtag.query(document, "x-iconbutton:focus").forEach(function(a) {
            a.blur()
        })
    }
    function e(a) {
        c(a), d()
    }
    var f = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", g = document.createElement("img").nodeName, h = function(a) {
        return a.xtag.contentEl.textContent
    }, i = function(a, b) {
        a.xtag.contentEl.textContent = b
    }, j = 32, k = 13, l = null;
    xtag.register("x-iconbutton", {lifecycle: {created: function() {
                var c = this.innerHTML;
                this.innerHTML = "<div class='x-iconbutton-content-wrap'><img class='x-iconbutton-icon'      src='" + f + "'/>" + "<span class='x-iconbutton-content'></span>" + "</div>" + "<div class='x-iconbutton-ghost'></div>", this.xtag.iconEl = this.querySelector(".x-iconbutton-icon"), this.xtag.contentEl = this.querySelector(".x-iconbutton-content"), this.xtag.contentEl.innerHTML = c, this.textGetter || (this.textGetter = h), this.textSetter || (this.textSetter = i), b(this), a(this), this.hasAttribute("tabindex") || this.setAttribute("tabindex", 0)
            },inserted: function() {
                l || (l = {tapend: xtag.addEvent(document, "tapend", e),dragend: xtag.addEvent(document, "dragend", e),keyup: xtag.addEvent(document, "keyup", c)}), b(this), a(this)
            },removed: function() {
                if (l && !document.query("x-calendar")) {
                    for (var a in l)
                        xtag.removeEvent(document, a, l[a]);
                    l = null
                }
            },attributeChanged: function() {
                var c = this.iconEl, d = this.contentEl;
                c.parentNode && c.parentNode.parentNode === this && d.parentNode && d.parentNode.parentNode === this || console.warn("inner DOM of the iconbutton appears to be out of sync; make sure that editing innerHTML or textContent is done through .contentEl, not directly on the iconbutton itself"), b(this), a(this)
            }},events: {tapstart: function(a) {
                a.currentTarget.setAttribute("active", !0)
            },keypress: function(a) {
                var b = a.key || a.keyCode;
                (b === j || b === k) && a.currentTarget.click()
            },keydown: function(a) {
                var b = a.key || a.keyCode;
                (b === j || b === k) && a.currentTarget.setAttribute("active", !0)
            }},accessors: {src: {attribute: {},get: function() {
                    return this.xtag.iconEl.getAttribute("src")
                },set: function(b) {
                    this.xtag.iconEl.setAttribute("src", b), this.xtag.iconEl.src = b, a(this, b)
                }},active: {attribute: {}},iconAnchor: {attribute: {name: "icon-anchor"},set: function() {
                    b(this)
                }},iconEl: {get: function() {
                    return this.xtag.iconEl
                }},contentEl: {get: function() {
                    return this.xtag.contentEl
                }}}})
}(), function() {
    function a(a) {
        var b = a.firstElementChild;
        if (!b)
            return {header: null,section: null,footer: null};
        var c = b.nextElementSibling;
        return {header: "HEADER" == b.nodeName ? b : null,section: "SECTION" == b.nodeName ? b : c && "SECTION" == c.nodeName ? c : null,footer: "FOOTER" == a.lastElementChild.nodeName ? a.lastElementChild : null}
    }
    function b(a, b) {
        var c = b.__layoutScroll__ = b.__layoutScroll__ || Object.defineProperty(b, "__layoutScroll__", {value: {last: b.scrollTop}}).__layoutScroll__, d = b.scrollTop, e = a.scrollBuffer;
        return c.max = c.max || Math.max(d + e, e), c.min = c.min || Math.max(d - e, e), c
    }
    function c(a, b) {
        a.setAttribute("content-maximizing", null), b.section && (b.header && (b.section.style.marginTop = "-" + b.header.getBoundingClientRect().height + "px"), b.footer && (b.section.style.marginBottom = "-" + b.footer.getBoundingClientRect().height + "px"))
    }
    function d(a, b) {
        a.removeAttribute("content-maximized"), a.removeAttribute("content-maximizing"), b.section && (b.section.style.marginTop = "", b.section.style.marginBottom = "")
    }
    function e(e) {
        if (!e.currentTarget.hasAttribute("content-maximizing")) {
            var f = e.target, g = e.currentTarget;
            if (this.scrollhide && (f.parentNode == g || xtag.matchSelector(f, g.scrollTarget))) {
                var h = f.scrollTop, i = g.scrollBuffer, j = a(g), k = b(g, f);
                h > k.last ? k.min = Math.max(h - i, i) : h < k.last && (k.max = Math.max(h + i, i)), g.maxcontent || (h > k.max && !g.hasAttribute("content-maximized") ? c(g, j) : h < k.min && d(g, j)), k.last = h
            }
        }
    }
    xtag.register("x-layout", {lifecycle: {created: function() {
            }},events: {scroll: e,transitionend: function(b) {
                var c = a(this);
                !this.hasAttribute("content-maximizing") || b.target != c.header && b.target != c.section && b.target != c.footer || (this.setAttribute("content-maximized", null), this.removeAttribute("content-maximizing"))
            },"tap:delegate(section)": function(b) {
                var e = b.currentTarget;
                if (e.taphide && this.parentNode == e) {
                    var f = a(e);
                    e.hasAttribute("content-maximizing") || e.hasAttribute("content-maximized") ? e.maxcontent || d(e, f) : c(e, f)
                }
            },"mouseover:delegate(section)": function(b) {
                var d = b.currentTarget;
                !d.hoverhide || this.parentNode != d || d.hasAttribute("content-maximized") || d.hasAttribute("content-maximizing") || b.relatedTarget && !this.contains(b.target) || c(d, a(d))
            },"mouseout:delegate(section)": function(b) {
                var c = b.currentTarget;
                !c.hoverhide || this.parentNode != c || !c.hasAttribute("content-maximized") && !c.hasAttribute("content-maximizing") || c != b.relatedTarget && c.contains(b.relatedTarget) || d(c, a(c))
            }},accessors: {scrollTarget: {attribute: {name: "scroll-target"}},scrollBuffer: {attribute: {name: "scroll-buffer"},get: function() {
                    return Number(this.getAttribute("scroll-buffer")) || 30
                }},taphide: {attribute: {"boolean": !0}},hoverhide: {attribute: {"boolean": !0}},scrollhide: {attribute: {"boolean": !0}},maxcontent: {attribute: {"boolean": !0},set: function(b) {
                    var e = a(this);
                    b ? c(this, e) : this.hasAttribute("content-maximizing") || d(this, e)
                }}}})
}(), function() {
    function a(a) {
        var b = xtag.query(a, "x-slides > x-slide[selected]")[0] || 0;
        return [b ? xtag.query(a, "x-slides > x-slide").indexOf(b) : b, a.firstElementChild.children.length - 1]
    }
    function b(a, b) {
        var c = xtag.toArray(a.firstElementChild.children);
        c.forEach(function(a) {
            a.removeAttribute("selected")
        }), c[b || 0].setAttribute("selected", !0);
        var e = "translate" + (a.getAttribute("orientation") || "x") + "(" + (b || 0) * (-100 / c.length) + "%)";
        a.firstElementChild.style[d] = e, a.firstElementChild.style.transform = e
    }
    function c(a) {
        var c = this.firstElementChild;
        if (c && c.children.length && "x-slides" == c.tagName.toLowerCase()) {
            var e = xtag.toArray(c.children), f = 100 / (e.length || 1), g = this.getAttribute("orientation") || "x", h = "x" == g ? ["width", "height"] : ["height", "width"];
            if (c.style[h[1]] = "100%", c.style[h[0]] = 100 * e.length + "%", c.style[d] = "translate" + g + "(0%)", c.style.transform = "translate" + g + "(0%)", e.forEach(function(a) {
                a.style[h[0]] = f + "%", a.style[h[1]] = "100%"
            }), a) {
                var i = c.querySelector("[selected]");
                i && b(this, e.indexOf(i) || 0)
            }
        }
    }
    var d = xtag.prefix.js + "Transform";
    xtag.register("x-slidebox", {lifecycle: {created: function() {
                c()
            }},events: {transitionend: function(a) {
                a.target == this.firstElementChild && xtag.fireEvent(this, "slideend")
            },"show:delegate(x-slide)": function(a) {
                var b = a.target;
                if ("x-slides" === b.parentNode.nodeName.toLowerCase() && "x-slidebox" === b.parentNode.parentNode.nodeName.toLowerCase()) {
                    var c = b.parentNode, d = c.parentNode, e = xtag.query(c, "x-slide");
                    d.slideTo(e.indexOf(b))
                }
            }},accessors: {orientation: {get: function() {
                    return this.getAttribute("orientation")
                },set: function(a) {
                    var b = this;
                    xtag.skipTransition(b.firstElementChild, function() {
                        b.setAttribute("orientation", a.toLowerCase()), c.call(b, !0)
                    })
                }}},methods: {slideTo: function(a) {
                b(this, a)
            },slideNext: function() {
                var c = a(this);
                c[0]++, b(this, c[0] > c[1] ? 0 : c[0])
            },slidePrevious: function() {
                var c = a(this);
                c[0]--, b(this, c[0] < 0 ? c[1] : c[0])
            }}}), xtag.register("x-slide", {lifecycle: {inserted: function() {
                var a = this.parentNode.parentNode;
                "x-slidebox" == a.tagName.toLowerCase() && c.call(a, !0)
            },created: function() {
                if (this.parentNode) {
                    var a = this.parentNode.parentNode;
                    "x-slidebox" == a.tagName.toLowerCase() && c.call(a, !0)
                }
            }}})
}(), function() {
    function a(a) {
        return !isNaN(parseFloat(a))
    }
    function b(b, c) {
        return b.hasAttribute(c) && a(b.getAttribute(c))
    }
    function c(b, c, d, e) {
        if (e = e ? e : Math.round, d = a(d) ? d : 0, !a(b))
            throw "invalid value " + b;
        if (!a(c) || 0 >= +c)
            throw "invalid step " + c;
        return e((b - d) / c) * c + d
    }
    function d(a, b, d, e) {
        return b > a ? b : a > d ? Math.max(b, c(d, e, b, Math.floor)) : a
    }
    function e(a, b, e) {
        var f = c((b - a) / 2 + a, e, a);
        return d(f, a, b, e)
    }
    function f(a, b) {
        var c = a.min, d = a.max;
        return (b - c) / (d - c)
    }
    function g(a, b) {
        var c = a.min, d = a.max;
        return (d - c) * b + c
    }
    function h(a, b) {
        b = Math.min(Math.max(0, b), 1);
        var e = g(a, b), f = c(e, a.step, a.min);
        return d(f, a.min, a.max, a.step)
    }
    function i(a, b) {
        var c = a.xtag.polyFillSliderThumb;
        if (c) {
            var d = a.getBoundingClientRect(), e = c.getBoundingClientRect(), g = f(a, b), h = Math.max(d.width - e.width, 0), i = h * g, j = i / d.width;
            c.style.left = 100 * j + "%"
        }
    }
    function j(a) {
        i(a, a.value)
    }
    function k(a, b) {
        var c = a.xtag.rangeInputEl, d = c.getBoundingClientRect(), e = b - d.left;
        a.value;
        var f = h(a, e / d.width);
        a.value = f, xtag.fireEvent(a, "input"), j(a)
    }
    function l(a, b, c) {
        a.xtag.dragInitVal = a.value, k(a, b, c);
        var d = a.xtag.callbackFns, e = function(a, b) {
            document.body.addEventListener(a, b)
        };
        e("mousemove", d.onMouseDragMove), e("touchmove", d.onTouchDragMove), e("mouseup", d.onDragEnd), e("touchend", d.onDragEnd);
        var f = a.xtag.polyFillSliderThumb;
        f && f.setAttribute("active", !0)
    }
    function m(a, b, c) {
        k(a, b, c)
    }
    function n(a) {
        return {onMouseDragStart: function(b) {
                b.button === p && (l(a, b.pageX, b.pageY), b.preventDefault())
            },onTouchDragStart: function(b) {
                var c = b.targetTouches;
                1 === c.length && (l(a, c[0].pageX, c[0].pageY), b.preventDefault())
            },onMouseDragMove: function(b) {
                m(a, b.pageX, b.pageY), b.preventDefault()
            },onTouchDragMove: function(b) {
                var c = b.targetTouches;
                1 === c.length && (m(a, c[0].pageX, c[0].pageY), b.preventDefault())
            },onDragEnd: function(b) {
                var c = a.xtag.callbackFns, d = function(a, b) {
                    document.body.removeEventListener(a, b)
                };
                d("mousemove", c.onMouseDragMove), d("touchmove", c.onTouchDragMove), d("mouseup", c.onDragEnd), d("touchend", c.onDragEnd);
                var e = a.xtag.polyFillSliderThumb;
                e && e.removeAttribute("active"), a.value !== a.xtag.dragInitVal && xtag.fireEvent(a, "change"), a.xtag.dragInitVal = null, b.preventDefault()
            },onKeyDown: function(a) {
                var b = a.keyCode;
                if (b in o) {
                    var c = this.value, d = this.min, e = this.max, f = this.step, g = Math.max(0, e - d), h = Math.max(g / 10, f);
                    switch (o[b]) {
                        case "LEFT_ARROW":
                        case "DOWN_ARROW":
                            this.value = Math.max(c - f, d);
                            break;
                        case "RIGHT_ARROW":
                        case "UP_ARROW":
                            this.value = Math.min(c + f, e);
                            break;
                        case "HOME":
                            this.value = d;
                            break;
                        case "END":
                            this.value = e;
                            break;
                        case "PAGE_DOWN":
                            this.value = Math.max(c - h, d);
                            break;
                        case "PAGE_UP":
                            this.value = Math.min(c + h, e)
                    }
                    this.value !== c && xtag.fireEvent(this, "change"), a.preventDefault()
                }
            }}
    }
    var o = {33: "PAGE_UP",34: "PAGE_DOWN",35: "END",36: "HOME",37: "LEFT_ARROW",38: "UP_ARROW",39: "RIGHT_ARROW",40: "DOWN_ARROW"}, p = 0;
    xtag.register("x-slider", {lifecycle: {created: function() {
                var a = this;
                a.xtag.callbackFns = n(a), a.xtag.dragInitVal = null;
                var c = document.createElement("input");
                xtag.addClass(c, "input"), c.setAttribute("type", "range");
                var d = b(a, "max") ? +a.getAttribute("max") : 100, f = b(a, "min") ? +a.getAttribute("min") : 0, g = b(a, "step") ? +a.getAttribute("step") : 1;
                g = g > 0 ? g : 1;
                var h = b(a, "value") ? +a.getAttribute("value") : e(f, d, g);
                c.setAttribute("max", d), c.setAttribute("min", f), c.setAttribute("step", g), c.setAttribute("value", h), a.xtag.rangeInputEl = c, a.appendChild(a.xtag.rangeInputEl), a.xtag.polyFillSliderThumb = null, "range" !== c.type || a.hasAttribute("polyfill") ? a.setAttribute("polyfill", !0) : a.removeAttribute("polyfill"), j(a)
            },attributeChanged: function() {
                j(this)
            }},events: {"change:delegate(input[type=range])": function(a) {
                a.stopPropagation(), xtag.fireEvent(a.currentTarget, "change")
            },"input:delegate(input[type=range])": function(a) {
                a.stopPropagation(), xtag.fireEvent(a.currentTarget, "input")
            },"focus:delegate(input[type=range])": function(a) {
                var b = a.currentTarget;
                xtag.fireEvent(b, "focus", {}, {bubbles: !1})
            },"blur:delegate(input[type=range])": function(a) {
                var b = a.currentTarget;
                xtag.fireEvent(b, "blur", {}, {bubbles: !1})
            }},accessors: {polyfill: {attribute: {"boolean": !0},set: function(a) {
                    var b = this.xtag.callbackFns;
                    if (a) {
                        if (this.setAttribute("tabindex", 0), this.xtag.rangeInputEl.setAttribute("tabindex", -1), this.xtag.rangeInputEl.setAttribute("readonly", !0), !this.xtag.polyFillSliderThumb) {
                            var c = document.createElement("span");
                            xtag.addClass(c, "slider-thumb"), this.xtag.polyFillSliderThumb = c, this.appendChild(c)
                        }
                        j(this), this.addEventListener("mousedown", b.onMouseDragStart), this.addEventListener("touchstart", b.onTouchDragStart), this.addEventListener("keydown", b.onKeyDown)
                    } else
                        this.removeAttribute("tabindex"), this.xtag.rangeInputEl.removeAttribute("tabindex"), this.xtag.rangeInputEl.removeAttribute("readonly"), this.removeEventListener("mousedown", b.onMouseDragStart), this.removeEventListener("touchstart", b.onTouchDragStart), this.removeEventListener("keydown", b.onKeyDown)
                }},max: {attribute: {selector: "input[type=range]"},get: function() {
                    return +this.xtag.rangeInputEl.getAttribute("max")
                }},min: {attribute: {selector: "input[type=range]"},get: function() {
                    return +this.xtag.rangeInputEl.getAttribute("min")
                }},step: {attribute: {selector: "input[type=range]"},get: function() {
                    return +this.xtag.rangeInputEl.getAttribute("step")
                }},name: {attribute: {selector: "input[type=range]"},set: function(a) {
                    var b = this.xtag.rangeInputEl;
                    null === a || void 0 === a ? b.removeAttribute("name") : b.setAttribute("name", a)
                }},value: {attribute: {selector: "input[type=range]"},get: function() {
                    return +this.xtag.rangeInputEl.value
                },set: function(b) {
                    a(b) || (b = e(this.min, this.max, this.step)), b = +b;
                    var f = this.min, g = this.max, h = this.step, i = c(b, h, f), k = d(i, f, g, h);
                    this.xtag.rangeInputEl.value = k, j(this)
                }},inputElem: {get: function() {
                    return this.xtag.rangeInputEl
                }}},methods: {}})
}(), function() {
    function a() {
        var a = document.documentElement, b = {left: a.scrollLeft || document.body.scrollLeft || 0,top: a.scrollTop || document.body.scrollTop || 0,width: a.clientWidth,height: a.clientHeight};
        return b.right = b.left + b.width, b.bottom = b.top + b.height, b
    }
    function b(b) {
        var c = b.getBoundingClientRect(), d = a(), e = d.left, f = d.top;
        return {left: c.left + e,right: c.right + e,top: c.top + f,bottom: c.bottom + f,width: c.width,height: c.height}
    }
    function c(a, b, c) {
        return c.left <= a && a <= c.right && c.top <= b && b <= c.bottom
    }
    function d(a) {
        if ("x-tabbar" === a.parentNode.nodeName.toLowerCase()) {
            var b = a.targetEvent, c = a.targetSelector ? xtag.query(document, a.targetSelector) : a.targetElems;
            c.forEach(function(a) {
                xtag.fireEvent(a, b)
            })
        }
    }
    xtag.register("x-tabbar", {lifecycle: {created: function() {
                this.xtag.overallEventToFire = "show"
            }},events: {"tap:delegate(x-tabbar-tab)": function() {
                var a = xtag.query(this.parentNode, "x-tabbar-tab[selected]");
                a.length && a.forEach(function(a) {
                    a.removeAttribute("selected")
                }), this.setAttribute("selected", !0)
            }},accessors: {tabs: {get: function() {
                    return xtag.queryChildren(this, "x-tabbar-tab")
                }},targetEvent: {attribute: {name: "target-event"},get: function() {
                    return this.xtag.overallEventToFire
                },set: function(a) {
                    this.xtag.overallEventToFire = a
                }}},methods: {}}), xtag.register("x-tabbar-tab", {lifecycle: {created: function() {
                this.xtag.targetSelector = null, this.xtag.overrideTargetElems = null, this.xtag.targetEvent = null
            }},events: {tap: function(a) {
                var e = a.currentTarget;
                if (a.changedTouches && a.changedTouches.length > 0) {
                    var f = a.changedTouches[0], g = b(e);
                    c(f.pageX, f.pageY, g) && d(e)
                } else
                    d(e)
            }},accessors: {targetSelector: {attribute: {name: "target-selector"},get: function() {
                    return this.xtag.targetSelector
                },set: function(a) {
                    this.xtag.targetSelector = a, a && (this.xtag.overrideTargetElems = null)
                }},targetElems: {get: function() {
                    return this.targetSelector ? xtag.query(document, this.targetSelector) : null !== this.xtag.overrideTargetElems ? this.xtag.overrideTargetElems : []
                },set: function(a) {
                    this.removeAttribute("target-selector"), this.xtag.overrideTargetElems = a
                }},targetEvent: {attribute: {name: "target-event"},get: function() {
                    if (this.xtag.targetEvent)
                        return this.xtag.targetEvent;
                    if ("x-tabbar" === this.parentNode.nodeName.toLowerCase())
                        return this.parentNode.targetEvent;
                    throw "tabbar-tab is missing event to fire"
                },set: function(a) {
                    this.xtag.targetEvent = a
                }}},methods: {}})
}(), function() {
    function a(a) {
        var b = a.xtag.inputEl.form;
        b ? a.removeAttribute("x-toggle-no-form") : a.setAttribute("x-toggle-no-form", ""), a.xtag.scope = a.parentNode ? b || document : null
    }
    function b(a) {
        var b = {}, c = a == document ? "[x-toggle-no-form]" : "";
        xtag.query(a, "x-toggle[name]" + c).forEach(function(d) {
            var e = d.name;
            if (e && !b[e]) {
                var f = xtag.query(a, 'x-toggle[name="' + e + '"]' + c), g = f.length > 1 ? "radio" : "checkbox";
                f.forEach(function(a) {
                    a.xtag && a.xtag.inputEl && (a.type = g)
                }), b[e] = !0
            }
        })
    }
    var c = !1;
    xtag.addEvents(document, {DOMComponentsLoaded: function() {
            b(document), xtag.toArray(document.forms).forEach(b)
        },WebComponentsReady: function() {
            b(document), xtag.toArray(document.forms).forEach(b)
        },keydown: function(a) {
            c = a.shiftKey
        },keyup: function(a) {
            c = a.shiftKey
        },"focus:delegate(x-toggle)": function() {
            this.setAttribute("focus", "")
        },"blur:delegate(x-toggle)": function() {
            this.removeAttribute("focus")
        },"tap:delegate(x-toggle)": function() {
            if (c && this.group) {
                var a = this.groupToggles, b = this.xtag.scope.querySelector('x-toggle[group="' + this.group + '"][active]');
                if (b && this != b) {
                    var d = this, e = b.checked, f = a.indexOf(this), g = a.indexOf(b), h = Math.min(f, g), i = Math.max(f, g);
                    a.slice(h, i).forEach(function(a) {
                        a != d && (a.checked = e)
                    })
                }
            }
        },"change:delegate(x-toggle)": function() {
            var a = this.xtag.scope.querySelector('x-toggle[group="' + this.group + '"][active]');
            this.checked = c && a && this != a ? a.checked : this.xtag.inputEl.checked, this.group && (this.groupToggles.forEach(function(a) {
                a.active = !1
            }), this.active = !0)
        }}), xtag.register("x-toggle", {lifecycle: {created: function() {
                this.innerHTML = '<label class="x-toggle-input-wrap"><input type="checkbox"></input></label><div class="x-toggle-check"></div><div class="x-toggle-content"></div>', this.xtag.inputWrapEl = this.querySelector(".x-toggle-input-wrap"), this.xtag.inputEl = this.xtag.inputWrapEl.querySelector("input"), this.xtag.contentWrapEl = this.querySelector(".x-toggle-content-wrap"), this.xtag.checkEl = this.querySelector(".x-toggle-check"), this.xtag.contentEl = this.querySelector(".x-toggle-content"), this.type = "checkbox", a(this);
                var b = this.getAttribute("name");
                b && (this.xtag.inputEl.name = this.getAttribute("name")), this.hasAttribute("checked") && (this.checked = !0)
            },inserted: function() {
                a(this), this.parentNode && "x-togglegroup" === this.parentNode.nodeName.toLowerCase() && (this.parentNode.hasAttribute("name") && (this.name = this.parentNode.getAttribute("name")), this.parentNode.hasAttribute("group") && (this.group = this.parentNode.getAttribute("group")), this.setAttribute("no-box", !0)), this.name && b(this.xtag.scope)
            },removed: function() {
                b(this.xtag.scope), a(this)
            }},accessors: {noBox: {attribute: {name: "no-box","boolean": !0},set: function() {
                }},type: {attribute: {},set: function(a) {
                    this.xtag.inputEl.type = a
                }},label: {attribute: {},get: function() {
                    return this.xtag.contentEl.innerHTML
                },set: function(a) {
                    this.xtag.contentEl.innerHTML = a
                }},active: {attribute: {"boolean": !0}},group: {attribute: {}},groupToggles: {get: function() {
                    return xtag.query(this.xtag.scope, 'x-toggle[group="' + this.group + '"]')
                }},name: {attribute: {skip: !0},get: function() {
                    return this.getAttribute("name")
                },set: function(a) {
                    null === a ? (this.removeAttribute("name"), this.type = "checkbox") : this.setAttribute("name", a), this.xtag.inputEl.name = a, b(this.xtag.scope)
                }},checked: {get: function() {
                    return this.xtag.inputEl.checked
                },set: function(a) {
                    var b = this.name, c = "true" === a || a === !0;
                    if (b) {
                        var d = this.xtag.scope == document ? "[x-toggle-no-form]" : "", e = 'x-toggle[checked][name="' + b + '"]' + d, f = this.xtag.scope.querySelector(e);
                        f && f.removeAttribute("checked")
                    }
                    this.xtag.inputEl.checked = c, c ? this.setAttribute("checked", "") : this.removeAttribute("checked")
                }},value: {attribute: {},get: function() {
                    return this.xtag.inputEl.value
                },set: function(a) {
                    this.xtag.inputEl.value = a
                }}}})
}(), function() {
    xtag.register("x-togglegroup", {lifecycle: {created: function() {
                this.options.forEach(function(a) {
                    this.name && (a.name = this.name), this.group && (a.group = this.group), a.noBox = !0
                }.bind(this))
            }},events: {},accessors: {name: {attribute: {selector: "x-toggle"},set: function(a) {
                    this.options.forEach(function(b) {
                        b.name = a
                    })
                }},group: {attribute: {selector: "x-toggle"},set: function(a) {
                    this.options.forEach(function(b) {
                        b.group = a
                    })
                }},options: {get: function() {
                    return xtag.queryChildren(this, "x-toggle")
                }}},methods: {}})
}(), function() {
    function a(a) {
        return a in G
    }
    function b() {
        var a = document.documentElement, b = {left: a.scrollLeft || document.body.scrollLeft || 0,top: a.scrollTop || document.body.scrollTop || 0,width: a.clientWidth,height: a.clientHeight};
        return b.right = b.left + b.width, b.bottom = b.top + b.height, b
    }
    function c(a) {
        var c = a.getBoundingClientRect(), d = b(), e = d.left, f = d.top;
        return {left: c.left + e,right: c.right + e,top: c.top + f,bottom: c.bottom + f,width: c.width,height: c.height}
    }
    function d(a, b) {
        return b = void 0 !== b ? b : c(a), {x: a.offsetWidth ? b.width / a.offsetWidth : 1,y: a.offsetHeight ? b.height / a.offsetHeight : 1}
    }
    function e(a, b) {
        if (a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top)
            return null;
        var c = {left: Math.max(a.left, b.left),top: Math.max(a.top, b.top),right: Math.min(a.right, b.right),bottom: Math.min(a.bottom, b.bottom)};
        return c.width = c.right - c.left, c.height = c.bottom - c.top, c.width < 0 || c.height < 0 ? null : c
    }
    function f(a, b, c) {
        this.eventType = b, this.listenerFn = c, this.elem = a, this._attachedFn = null
    }
    function g(a) {
        this._cachedListener = null, this._tooltips = [];
        var b = this, c = function(a) {
            b._tooltips.forEach(function(b) {
                b.xtag._skipOuterClick || !b.hasAttribute("visible") || b.ignoreOuterTrigger || n(a.target, b) || B(b), b.xtag._skipOuterClick = !1
            })
        }, d = this._cachedListener = new f(document, a, c);
        d.attachListener()
    }
    function h() {
        this.eventStructDict = {}
    }
    function i(a, b, c) {
        var d = function(b) {
            c && n(b.target, a.previousElementSibling) && c.call(a.previousElementSibling, b)
        };
        return new f(document.documentElement, b, d)
    }
    function j(a, b, c) {
        var d = b + ":delegate(x-tooltip+*)", e = function(b) {
            c && this === a.nextElementSibling && c.call(this, b)
        };
        return new f(document.documentElement, d, e)
    }
    function k(a, b, c, d) {
        if (b === H)
            return i(a, c, d);
        if (b === I)
            return j(a, c, d);
        var e = c + ":delegate(" + b + ")";
        return new f(document.documentElement, e, function(b) {
            var c = this;
            n(c, a) || d.call(c, b)
        })
    }
    function l(a, b, c) {
        var d = [], e = function() {
            var b = this;
            a.xtag._skipOuterClick = !0, a.hasAttribute("visible") ? b === a.xtag.lastTargetElem ? B(a) : A(a, b) : A(a, b)
        }, f = k(a, b, c, e);
        return d.push(f), d
    }
    function m(a, b) {
        for (; a; ) {
            if (b(a))
                return a;
            a = a.parentNode
        }
        return null
    }
    function n(a, b) {
        if (b.contains)
            return b.contains(a);
        var c = function(a) {
            return a === b
        };
        return !!m(a, c)
    }
    function o(a) {
        return function(b) {
            var c = this, d = b.relatedTarget || b.toElement;
            d ? n(d, c) || a.call(this, b) : a.call(this, b)
        }
    }
    function p(a, b) {
        var c = [];
        c = b === H ? a.previousElementSibling ? [a.previousElementSibling] : [] : b === I ? a.nextElementSibling ? [a.nextElementSibling] : [] : xtag.query(document, b);
        for (var d = 0; d < c.length; ) {
            var e = c[d];
            n(e, a) ? c.splice(d, 1) : d++
        }
        return c
    }
    function q(a, b) {
        var d = function(a, b, c) {
            return c.left <= a && a <= c.right && c.top <= b && b <= c.bottom
        }, e = c(a), f = c(b), g = function(a, b) {
            return d(a.left, a.top, b) || d(a.right, a.top, b) || d(a.right, a.bottom, b) || d(a.left, a.bottom, b)
        }, h = function(a, b) {
            return a.top <= b.top && b.bottom <= a.bottom && b.left <= a.left && a.right <= b.right
        };
        return g(e, f) || g(f, e) || h(e, f) || h(f, e)
    }
    function r(a, b, c) {
        var d = c * (Math.PI / 180), e = a * Math.sin(d) + b * Math.cos(d), f = a * Math.cos(d) + b * Math.sin(d);
        return {height: e,width: f}
    }
    function s(a, b, c) {
        var d = a;
        return d = void 0 !== b && null !== b ? Math.max(b, d) : d, d = void 0 !== c && null !== c ? Math.min(c, d) : d
    }
    function t(a, b, e, f, g) {
        var h, i;
        if (e === window)
            h = a, i = b;
        else {
            var j = c(e);
            h = a - j.left, i = b - j.top
        }
        var k = c(f);
        g = g ? g : d(f, k);
        var l = f.clientTop * g.y, m = f.clientLeft * g.x, o = f.scrollTop * g.y, p = f.scrollLeft * g.x, q = {left: h - k.left - m,top: i - k.top - l};
        return !n(document.body, f) && n(f, document.body) && (q.top += o, q.left += p), q
    }
    function u(a, d) {
        d || (d = c(a.offsetParent || a.parentNode));
        var f = b(), g = f;
        return a.allowOverflow || (g = e(f, d), g || (g = d)), g
    }
    function v(a, b) {
        if (0 === b.length)
            return null;
        for (var c = u(a), d = c.left, e = c.top, f = c.right, g = c.bottom, h = [], i = [], j = 0; j < b.length; j++) {
            var k = b[j], l = k.rect;
            l.left < d || l.top < e || l.right > f || l.bottom > g ? i.push(k) : h.push(k)
        }
        var m = h.length > 0 ? h : i;
        return m[0].orient
    }
    function w(a) {
        a.setAttribute("_force-display", !0)
    }
    function x(a) {
        a.removeAttribute("_force-display")
    }
    function y(b, c) {
        b.removeAttribute(K);
        var d = b.xtag.arrowEl, e = null, f = [];
        for (var g in G)
            d.setAttribute(J, G[g]), e = z(b, c, g), e && (w(b), q(b, c) || f.push({orient: g,rect: e}), x(b));
        var h = v(b, f);
        return h || (h = "top"), b.setAttribute(K, h), d.setAttribute(J, G[h]), a(h) && h !== g ? z(b, c, h) : e
    }
    function z(e, f, g, h) {
        if (!e.parentNode)
            return e.left = "", e.top = "", null;
        h = void 0 === h ? 0 : h;
        var i = e.xtag.arrowEl;
        if (!a(g))
            return y(e, f);
        var j = e.offsetParent ? e.offsetParent : e.parentNode;
        h || (e.style.top = "", e.style.left = "", i.style.top = "", i.style.left = ""), w(e);
        var k = b(), l = c(j), o = d(j, l), p = j.clientWidth * o.x, q = j.clientHeight * o.y, v = c(f), A = v.width, B = v.height, C = c(e), D = d(e, C), E = C.width, F = C.height, G = C.width, H = C.height, I = (G - E) / 2, J = (H - F) / 2, K = i.offsetWidth * D.x, L = i.offsetHeight * D.y, M = 45, N = r(K, L, M);
        K = N.width, L = N.height, "top" === g || "bottom" === g ? L /= 2 : K /= 2;
        var O = u(e, l), P = O.left, Q = O.top, R = O.right - E, S = O.bottom - F, T = {left: v.left + (A - E) / 2,top: v.top + (B - F) / 2}, U = T.left, V = T.top;
        if ("top" === g)
            V = v.top - H - L, S -= L;
        else if ("bottom" === g)
            V = v.top + B + L, S -= L;
        else if ("left" === g)
            U = v.left - G - K, R -= K;
        else {
            if ("right" !== g)
                throw "invalid orientation " + g;
            U = v.left + A + K, R -= K
        }
        var W = s(U, P, R), X = s(V, Q, S);
        W += I, X += J;
        var Y, Z, $ = function(a) {
            if (!window.getComputedStyle || a === document || a === document.documentElement)
                return !1;
            var b;
            try {
                b = window.getComputedStyle(a)
            } catch (c) {
                return !1
            }
            return b && "fixed" === b.position
        }, _ = m(f, $);
        if (_ && !n(e, _))
            Y = W - k.left, Z = X - k.top, e.setAttribute("_target-fixed", !0);
        else {
            var ab = t(W, X, window, j, o);
            Y = ab.left, Z = ab.top, e.removeAttribute("_target-fixed")
        }
        e.style.top = Z + "px", e.style.left = Y + "px";
        var bb, cb, db, eb, fb;
        "top" === g || "bottom" === g ? (eb = (A - K) / 2, fb = v.left - W, bb = E - K, cb = E, db = "left") : (eb = (B - L) / 2, fb = v.top - X, bb = F - L, cb = F, db = "top");
        var gb = s(eb + fb, 0, bb), hb = cb ? gb / cb : 0;
        i.style[db] = 100 * hb + "%";
        var ib = e.offsetWidth * D.x, jb = e.offsetHeight * D.y, kb = j.clientWidth * o.x, lb = j.clientHeight * o.y;
        x(e);
        var mb = 2;
        return mb > h && (E !== ib || F !== jb || p !== kb || q !== lb) ? z(e, f, g, h + 1) : {left: W,top: X,width: ib,height: jb,right: W + ib,bottom: X + jb}
    }
    function A(a, b) {
        b === a && console.warn("The tooltip's target element is the tooltip itself! Is this intentional?");
        var c = a.xtag.arrowEl;
        c.parentNode || console.warn("The inner component DOM of the tooltip appears to be missing. Make sure to edit tooltip contents through the .contentEl property instead ofdirectly on the x-tooltip to avoid clobbering the component's internals.");
        var d = a.orientation, e = function() {
            x(a), a.setAttribute("visible", !0), xtag.fireEvent(a, "tooltipshown", {triggerElem: b})
        };
        b ? (a.xtag.lastTargetElem = b, xtag.skipTransition(a, function() {
            return z(a, b, d), e
        })) : (a.style.top = "", a.style.left = "", c.style.top = "", c.style.left = "", e())
    }
    function B(b) {
        a(b.orientation) && b.removeAttribute(K), b.hasAttribute("visible") && (w(b), b.xtag._hideTransitionFlag = !0, b.removeAttribute("visible"))
    }
    function C(a) {
        var b = a.xtag.cachedListeners;
        b.forEach(function(a) {
            a.removeListener()
        }), a.xtag.cachedListeners = [], E.unregisterTooltip(a.triggerStyle, a)
    }
    function D(a, b, c) {
        if (a.parentNode) {
            (void 0 === b || null === b) && (b = a.targetSelector), (void 0 === c || null === c) && (c = a.triggerStyle);
            var d = p(a, b);
            -1 === d.indexOf(a.xtag.lastTargetElem) && (a.xtag.lastTargetElem = d.length > 0 ? d[0] : null, z(a, a.xtag.lastTargetElem, a.orientation)), C(a);
            var e;
            if (c in F) {
                var f = F[c];
                e = f(a, b)
            } else
                e = l(a, b, c), E.registerTooltip(c, a);
            e.forEach(function(a) {
                a.attachListener()
            }), a.xtag.cachedListeners = e, B(a)
        }
    }
    var E, F, G = {top: "down",bottom: "up",left: "right",right: "left"}, H = "_previousSibling", I = "_nextSibling", J = "arrow-direction", K = "_auto-orientation";
    f.prototype.attachListener = function() {
        this._attachedFn || (this._attachedFn = xtag.addEvent(this.elem, this.eventType, this.listenerFn))
    }, f.prototype.removeListener = function() {
        this._attachedFn && (xtag.removeEvent(this.elem, this.eventType, this._attachedFn), this._attachedFn = null)
    }, g.prototype.destroy = function() {
        this._cachedListener.removeListener(), this._cachedListener = null, this._tooltips = null
    }, g.prototype.containsTooltip = function(a) {
        return -1 !== this._tooltips.indexOf(a)
    }, g.prototype.addTooltip = function(a) {
        this.containsTooltip(a) || this._tooltips.push(a)
    }, g.prototype.removeTooltip = function(a) {
        this.containsTooltip(a) && this._tooltips.splice(this._tooltips.indexOf(a), 1)
    }, Object.defineProperties(g.prototype, {numTooltips: {get: function() {
                return this._tooltips.length
            }}}), h.prototype.registerTooltip = function(a, b) {
        if (a in this.eventStructDict) {
            var c = this.eventStructDict[a];
            c.containsTooltip(b) || c.addTooltip(b)
        } else
            this.eventStructDict[a] = new g(a), this.eventStructDict[a].addTooltip(b)
    }, h.prototype.unregisterTooltip = function(a, b) {
        if (a in this.eventStructDict && this.eventStructDict[a].containsTooltip(b)) {
            var c = this.eventStructDict[a];
            c.removeTooltip(b), 0 === c.numTooltips && (c.destroy(), delete this.eventStructDict[a])
        }
    }, E = new h, F = {custom: function() {
            return []
        },hover: function(a, b) {
            var c = [], d = null, e = 200, g = function() {
                d && window.clearTimeout(d), d = null
            }, h = o(function(b) {
                g();
                var c = this, d = b.relatedTarget || b.toElement;
                n(d, a) || A(a, c)
            }), i = o(function(b) {
                g();
                var c = b.relatedTarget || b.toElement;
                n(c, a) || (d = window.setTimeout(function() {
                    "hover" === a.triggerStyle && B(a)
                }, e))
            }), j = k(a, b, "enter", h), l = k(a, b, "leave", i);
            c.push(j), c.push(l);
            var m = o(function(b) {
                g();
                var c = b.relatedTarget || b.toElement, d = a.xtag.lastTargetElem;
                a.hasAttribute("visible") || !d || n(c, d) || A(a, d)
            }), p = o(function(b) {
                g();
                var c = b.relatedTarget || b.toElement, f = a.xtag.lastTargetElem;
                f && !n(c, f) && (d = window.setTimeout(function() {
                    "hover" === a.triggerStyle && B(a)
                }, e))
            });
            return c.push(new f(a, "enter", m)), c.push(new f(a, "leave", p)), c
        }}, xtag.register("x-tooltip", {lifecycle: {created: function() {
                var a = this;
                a.xtag.contentEl = document.createElement("div"), a.xtag.arrowEl = document.createElement("span"), xtag.addClass(a.xtag.contentEl, "tooltip-content"), xtag.addClass(a.xtag.arrowEl, "tooltip-arrow"), a.xtag.contentEl.innerHTML = a.innerHTML, a.innerHTML = "", a.appendChild(a.xtag.contentEl), a.appendChild(a.xtag.arrowEl), a.xtag._orientation = "auto", a.xtag._targetSelector = H, a.xtag._triggerStyle = "click";
                var b = p(a, a.xtag._targetSelector);
                a.xtag.lastTargetElem = b.length > 0 ? b[0] : null, a.xtag.cachedListeners = [], a.xtag._hideTransitionFlag = !1, a.xtag._skipOuterClick = !1
            },inserted: function() {
                D(this, this.xtag._targetSelector, this.xtag._triggerStyle)
            },removed: function() {
                C(this)
            }},events: {transitionend: function(a) {
                var b = a.currentTarget;
                b.xtag._hideTransitionFlag && !b.hasAttribute("visible") && (b.xtag._hideTransitionFlag = !1, xtag.fireEvent(b, "tooltiphidden")), x(b)
            }},accessors: {orientation: {attribute: {},get: function() {
                    return this.xtag._orientation
                },set: function(b) {
                    b = b.toLowerCase();
                    var c = this.querySelector(".tooltip-arrow"), d = null;
                    a(b) ? (d = G[b], c.setAttribute(J, d), this.removeAttribute(K)) : c.removeAttribute(J), this.xtag._orientation = b, this.refreshPosition()
                }},triggerStyle: {attribute: {name: "trigger-style"},get: function() {
                    return this.xtag._triggerStyle
                },set: function(a) {
                    D(this, this.targetSelector, a), this.xtag._triggerStyle = a
                }},targetSelector: {attribute: {name: "target-selector"},get: function() {
                    return this.xtag._targetSelector
                },set: function(a) {
                    p(this, a), D(this, a, this.triggerStyle), this.xtag._targetSelector = a
                }},ignoreOuterTrigger: {attribute: {"boolean": !0,name: "ignore-outer-trigger"}},ignoreTooltipPointerEvents: {attribute: {"boolean": !0,name: "ignore-tooltip-pointer-events"}},allowOverflow: {attribute: {"boolean": !0,name: "allow-overflow"},set: function() {
                    this.refreshPosition()
                }},contentEl: {get: function() {
                    return this.xtag.contentEl
                },set: function(a) {
                    var b = this.xtag.contentEl;
                    xtag.addClass(a, "tooltip-content"), this.replaceChild(a, b), this.xtag.contentEl = a, this.refreshPosition()
                }},presetTriggerStyles: {get: function() {
                    var a = [];
                    for (var b in F)
                        a.push(b);
                    return a
                }},targetElems: {get: function() {
                    return p(this, this.targetSelector)
                }}},methods: {refreshPosition: function() {
                this.xtag.lastTargetElem && z(this, this.xtag.lastTargetElem, this.orientation)
            },show: function() {
                A(this, this.xtag.lastTargetElem)
            },hide: function() {
                B(this)
            },toggle: function() {
                this.hasAttribute("visible") ? this.hide() : this.show()
            }}})
}();