"format global";
(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  var getOwnPropertyDescriptor = true;
  try {
    Object.getOwnPropertyDescriptor({ a: 0 }, 'a');
  }
  catch(e) {
    getOwnPropertyDescriptor = false;
  }

  var defineProperty;
  (function () {
    try {
      if (!!Object.defineProperty({}, 'a', {}))
        defineProperty = Object.defineProperty;
    }
    catch (e) {
      defineProperty = function(obj, prop, opt) {
        try {
          obj[prop] = opt.value || opt.get.call(obj);
        }
        catch(e) {}
      }
    }
  })();

  function register(name, deps, declare) {
    if (arguments.length === 4)
      return registerDynamic.apply(this, arguments);
    doRegister(name, {
      declarative: true,
      deps: deps,
      declare: declare
    });
  }

  function registerDynamic(name, deps, executingRequire, execute) {
    doRegister(name, {
      declarative: false,
      deps: deps,
      executingRequire: executingRequire,
      execute: execute
    });
  }

  function doRegister(name, entry) {
    entry.name = name;

    // we never overwrite an existing define
    if (!(name in defined))
      defined[name] = entry;

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }


  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];

      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;

      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {

        // if already in a group, remove from the old group
        if (depEntry.groupIndex !== undefined) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;

      if (typeof name == 'object') {
        for (var p in name)
          exports[p] = name[p];
      }
      else {
        exports[name] = value;
      }

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          for (var j = 0; j < importerModule.dependencies.length; ++j) {
            if (importerModule.dependencies[j] === module) {
              importerModule.setters[j](exports);
            }
          }
        }
      }

      module.locked = false;
      return value;
    });

    module.setters = declaration.setters;
    module.execute = declaration.execute;

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        depExports = depEntry.esModule;
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);

      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);

    if (output)
      module.exports = output;

    // create the esModule object, which allows ES6 named imports of dynamics
    exports = module.exports;
 
    if (exports && exports.__esModule) {
      entry.esModule = exports;
    }
    else {
      entry.esModule = {};
      
      // don't trigger getters/setters in environments that support them
      if (typeof exports == 'object' || typeof exports == 'function') {
        if (getOwnPropertyDescriptor) {
          var d;
          for (var p in exports)
            if (d = Object.getOwnPropertyDescriptor(exports, p))
              defineProperty(entry.esModule, p, d);
        }
        else {
          var hasOwnProperty = exports && exports.hasOwnProperty;
          for (var p in exports) {
            if (!hasOwnProperty || exports.hasOwnProperty(p))
              entry.esModule[p] = exports[p];
          }
         }
       }
      entry.esModule['default'] = exports;
      defineProperty(entry.esModule, '__useDefault', {
        value: true
      });
    }
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (!entry || entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    // node core modules
    if (name.substr(0, 6) == '@node/')
      return require(name.substr(6));

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    // exported modules get __esModule defined for interop
    if (entry.declarative)
      defineProperty(entry.module.exports, '__esModule', { value: true });

    // return the defined module object
    return modules[name] = entry.declarative ? entry.module.exports : entry.esModule;
  };

  return function(mains, depNames, declare) {
    return function(formatDetect) {
      formatDetect(function(deps) {
        var System = {
          _nodeRequire: typeof require != 'undefined' && require.resolve && typeof process != 'undefined' && require,
          register: register,
          registerDynamic: registerDynamic,
          get: load, 
          set: function(name, module) {
            modules[name] = module; 
          },
          newModule: function(module) {
            return module;
          }
        };
        System.set('@empty', {});

        // register external dependencies
        for (var i = 0; i < depNames.length; i++) (function(depName, dep) {
          if (dep && dep.__esModule)
            System.register(depName, [], function(_export) {
              return {
                setters: [],
                execute: function() {
                  for (var p in dep)
                    if (p != '__esModule' && !(typeof p == 'object' && p + '' == 'Module'))
                      _export(p, dep[p]);
                }
              };
            });
          else
            System.registerDynamic(depName, [], false, function() {
              return dep;
            });
        })(depNames[i], arguments[i]);

        // register modules in this bundle
        declare(System);

        // load mains
        var firstLoad = load(mains[0]);
        if (mains.length > 1)
          for (var i = 1; i < mains.length; i++)
            load(mains[i]);

        if (firstLoad.__useDefault)
          return firstLoad['default'];
        else
          return firstLoad;
      });
    };
  };

})(typeof self != 'undefined' ? self : global)
/* (['mainModule'], ['external-dep'], function($__System) {
  System.register(...);
})
(function(factory) {
  if (typeof define && define.amd)
    define(['external-dep'], factory);
  // etc UMD / module pattern
})*/

(['1'], [], function($__System) {

(function(__moduleName) {
  $__System.register("2", [], function(exports_1) {
    var assignBase,
        extend,
        defaults,
        forEachKey,
        resolve;
    return {
      setters: [],
      execute: function() {
        exports_1("assignBase", assignBase = function(assign) {
          var collections = [];
          for (var _i = 1; _i < arguments.length; _i++) {
            collections[_i - 1] = arguments[_i];
          }
          return collections.reduceRight(function(source, destination) {
            forEachKey(source, function(key) {
              var value = assign(source, key, destination);
              if (value) {
                destination[key] = value;
              }
            });
            return destination;
          });
        });
        exports_1("extend", extend = function() {
          var collections = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            collections[_i - 0] = arguments[_i];
          }
          return assignBase.apply(void 0, [function(source, key, destination) {
            var value = source[key];
            return (value === void 0) ? null : value;
          }].concat(collections));
        });
        exports_1("defaults", defaults = function() {
          var collections = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            collections[_i - 0] = arguments[_i];
          }
          return assignBase.apply(void 0, [function(source, key, destination) {
            if (destination[key] !== void 0)
              return null;
            return source[key];
          }].concat(collections));
        });
        exports_1("forEachKey", forEachKey = function(collection, assign) {
          Object.keys(collection).forEach(assign);
        });
        exports_1("resolve", resolve = function(obj, prop) {
          return prop.split(/\[|\]|\.|'|"/g).filter(function(v) {
            return v;
          }).reduce(function(a, b) {
            return a[b];
          }, obj);
        });
      }
    };
  });
})("file:///D:/projects/task-suitsupply/src/core/primitives/collection.ts");

(function(__moduleName) {
  $__System.register("3", ["2"], function(exports_1) {
    var __extends = (this && this.__extends) || function(d, b) {
      for (var p in b)
        if (b.hasOwnProperty(p))
          d[p] = b[p];
      function __() {
        this.constructor = d;
      }
      d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
    var collection_1;
    var XHR,
        Get,
        GetJSON,
        GetHTML;
    return {
      setters: [function(collection_1_1) {
        collection_1 = collection_1_1;
      }],
      execute: function() {
        XHR = (function() {
          function XHR(xhrConfig, paused) {
            var _this = this;
            if (paused === void 0) {
              paused = false;
            }
            this.xhrConfig = xhrConfig;
            this.init = function() {
              var xhr = _this.XMLHttpRequest,
                  cfg = _this.xhrConfig;
              xhr.open(cfg.method, cfg.url, cfg.async);
              if (cfg.headers) {
                cfg.headers.forEach(function(header) {
                  xhr.setRequestHeader(header.header, header.value);
                });
              }
              ['responseType', 'timeout'].forEach(function(value) {
                if (cfg[value] && value in xhr) {
                  xhr[value] = cfg[value];
                }
              });
              xhr.onreadystatechange = function(event) {
                _this.onReadyStateChange(event);
              };
              xhr.onerror = _this.onError;
              xhr.send(cfg.data);
              return _this;
            };
            this.onReadyStateChange = function(event) {
              var xhr = _this.XMLHttpRequest,
                  readyState = xhr.readyState;
              switch (readyState) {
                case xhr.DONE:
                  if (xhr.status < 200 || xhr.status > 226) {
                    _this.onError(xhr.status);
                  } else {
                    _this.onSuccess(xhr.response);
                  }
                default:
                  _this.onProgress(readyState);
              }
            };
            this.onSuccess = function(response) {};
            this.onError = function(event) {};
            this.onProgress = function(state) {};
            this.fail = function(errorCallback) {
              _this.onError = errorCallback;
              return _this;
            };
            this.done = function(successCallback) {
              _this.onSuccess = successCallback;
              return _this;
            };
            this.notify = function(progressCallback) {
              _this.onProgress = progressCallback;
              return _this;
            };
            this.XMLHttpRequest = new XMLHttpRequest();
            collection_1.extend(xhrConfig, {async: true});
            collection_1.defaults(xhrConfig, {method: 'GET'});
            if (!paused)
              this.init();
            return this;
          }
          return XHR;
        })();
        exports_1("default", XHR);
        Get = (function(_super) {
          __extends(Get, _super);
          function Get(xhrConfig, paused) {
            collection_1.extend(xhrConfig, {method: 'GET'});
            _super.call(this, xhrConfig, paused);
          }
          return Get;
        })(XHR);
        exports_1("Get", Get);
        GetJSON = (function(_super) {
          __extends(GetJSON, _super);
          function GetJSON(xhrConfig, paused) {
            collection_1.extend(xhrConfig, {
              responseType: 'json',
              headers: [{
                header: "Content-Type",
                value: "application/json"
              }]
            });
            _super.call(this, xhrConfig, paused);
          }
          return GetJSON;
        })(Get);
        exports_1("GetJSON", GetJSON);
        GetHTML = (function(_super) {
          __extends(GetHTML, _super);
          function GetHTML(xhrConfig, paused) {
            collection_1.extend(xhrConfig, {headers: [{
                header: "Content-Type",
                value: "text/html"
              }]});
            _super.call(this, xhrConfig, paused);
          }
          return GetHTML;
        })(Get);
        exports_1("GetHTML", GetHTML);
      }
    };
  });
})("file:///D:/projects/task-suitsupply/src/core/async/xhr.ts");

(function(__moduleName) {
  $__System.register("4", ["2"], function(exports_1) {
    var collection_1;
    var template,
        groupTemplate;
    return {
      setters: [function(collection_1_1) {
        collection_1 = collection_1_1;
      }],
      execute: function() {
        exports_1("template", template = function(tmpl) {
          var element = document.createElement(tmpl.tag);
          if (tmpl.content) {
            var tmplContents = [].concat(tmpl.content);
            tmplContents.forEach(function(value, key, collection) {
              if (typeof value !== 'object') {
                return element.insertAdjacentHTML('beforeend', value);
              }
              return element.appendChild(template(value));
            });
          }
          if (tmpl.attributes) {
            collection_1.forEachKey(tmpl.attributes, function(key) {
              element.setAttribute(key, tmpl.attributes[key]);
            });
          }
          return element;
        });
        exports_1("groupTemplate", groupTemplate = function() {
          var tmpls = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            tmpls[_i - 0] = arguments[_i];
          }
          var fragment = document.createDocumentFragment();
          tmpls.forEach(function(node) {
            fragment.appendChild(template(node));
          });
          return fragment;
        });
      }
    };
  });
})("file:///D:/projects/task-suitsupply/src/core/dom/template.ts");

(function(__moduleName) {
  $__System.register("5", ["2"], function(exports_1) {
    var collection_1;
    var capitalize,
        uppercase,
        prefixCamelCase,
        interpolate;
    return {
      setters: [function(collection_1_1) {
        collection_1 = collection_1_1;
      }],
      execute: function() {
        exports_1("capitalize", capitalize = function(base) {
          return base.charAt(0).toUpperCase() + base.slice(1);
        });
        exports_1("uppercase", uppercase = function(base) {
          return base.toUpperCase();
        });
        exports_1("prefixCamelCase", prefixCamelCase = function(prefix, base) {
          return prefix + capitalize(base);
        });
        exports_1("interpolate", interpolate = function(base, data, delimiter) {
          return base.replace(delimiter || /\{\{([\s\S]+?)\}\}/m, function(m, p1) {
            return collection_1.resolve(data, p1.trim());
          });
        });
      }
    };
  });
})("file:///D:/projects/task-suitsupply/src/core/primitives/string.ts");

(function(__moduleName) {
  $__System.register("6", ["5"], function(exports_1) {
    var string_1;
    var Δ,
        traverseTextNode,
        assignDelimitedTextNode,
        interpolateTextNode,
        replaceTextNode,
        injectHTML;
    return {
      setters: [function(string_1_1) {
        string_1 = string_1_1;
      }],
      execute: function() {
        exports_1("Δ", Δ = document.querySelectorAll.bind(document));
        exports_1("traverseTextNode", traverseTextNode = function(element, query) {
          var nodes = [];
          [].forEach.call(element.querySelectorAll(query), function(node) {
            if (!node.childNodes.length)
              return;
            nodes = nodes.concat([].filter.call(node.childNodes, function(child) {
              return (child.nodeName === '#text' || child instanceof Text);
            }));
          });
          return nodes;
        });
        exports_1("assignDelimitedTextNode", assignDelimitedTextNode = function(element, query, delimiter, assign) {
          traverseTextNode(element, query).filter(function(node) {
            return delimiter.test(node.textContent);
          }).forEach(function(textNode) {
            assign(textNode);
          });
          return element;
        });
        exports_1("interpolateTextNode", interpolateTextNode = function(element, interpolateQuery, data) {
          var query = "[data-interpolate" + ((!interpolateQuery) ? '' : "=" + interpolateQuery) + "]",
              delimiter = /\{\{([\s\S]+?)\}\}/m;
          assignDelimitedTextNode(element, query, delimiter, function(textNode) {
            var newNode = document.createElement('span');
            newNode.insertAdjacentHTML('beforeend', string_1.interpolate(textNode.textContent, data));
            textNode.parentNode.replaceChild(newNode, textNode);
          });
          return element;
        });
        exports_1("replaceTextNode", replaceTextNode = function(element, replaceQuery, replaceNode) {
          var query = "[data-replace" + ((!replaceQuery) ? '' : "=" + replaceQuery) + "]",
              delimiter = /\{\{([\s\S]+?)\}\}/m;
          assignDelimitedTextNode(element, query, delimiter, function(textNode) {
            textNode.parentNode.replaceChild(replaceNode, textNode);
          });
          return element;
        });
        exports_1("injectHTML", injectHTML = function(elementBase, injectQuery, injectNode) {
          var query = "[data-inject" + ((!injectQuery) ? '' : "=" + injectQuery) + "]",
              elements = elementBase.querySelectorAll(query);
          if (injectNode instanceof DocumentFragment) {
            return elements[0].appendChild(injectNode);
          }
          return [].slice.call(elements, function(element) {
            element.insertAdjacentHTML('beforeend', injectNode);
          });
        });
      }
    };
  });
})("file:///D:/projects/task-suitsupply/src/core/dom/manipulation.ts");

(function(__moduleName) {
  $__System.register("7", [], function(exports_1) {
    var dateString;
    return {
      setters: [],
      execute: function() {
        exports_1("dateString", dateString = function(date) {
          return new Date(date).toDateString();
        });
      }
    };
  });
})("file:///D:/projects/task-suitsupply/src/core/primitives/date.ts");

(function(__moduleName) {
  $__System.register("8", [], function(exports_1) {
    var log;
    return {
      setters: [],
      execute: function() {
        exports_1("log", log = function() {
          var messages = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            messages[_i - 0] = arguments[_i];
          }
          return console.log.apply(console, messages);
        });
      }
    };
  });
})("file:///D:/projects/task-suitsupply/src/core/utils/debug.ts");

(function(__moduleName) {
  $__System.register("1", ["3", "4", "6", "7", "8"], function(exports_1) {
    var xhr_1,
        template_1,
        manipulation_1,
        date_1,
        debug_1;
    var foo;
    function relatedStoryFragmentTest(data) {
      var relatedStoryTemplates = data.map(function(v, k, c) {
        return {
          tag: 'div',
          content: {
            tag: 'h4',
            content: {
              tag: 'a',
              attributes: {href: decodeURIComponent(v.url)},
              content: [{
                tag: 'span',
                content: v.title
              }, {
                tag: 'span',
                content: " ( " + date_1.dateString(v.publishedDate) + " ) "
              }]
            }
          }
        };
      });
      return template_1.groupTemplate.apply(null, relatedStoryTemplates);
    }
    return {
      setters: [function(xhr_1_1) {
        xhr_1 = xhr_1_1;
      }, function(template_1_1) {
        template_1 = template_1_1;
      }, function(manipulation_1_1) {
        manipulation_1 = manipulation_1_1;
      }, function(date_1_1) {
        date_1 = date_1_1;
      }, function(debug_1_1) {
        debug_1 = debug_1_1;
      }],
      execute: function() {
        debug_1.log('hello from core.ts');
        foo = new xhr_1.GetHTML({url: 'story.html'}).done(function(r0) {
          var bar = new xhr_1.GetJSON({url: 'data.json'}).done(function(r1) {
            var r1 = r1.results[0];
            document.body.insertAdjacentHTML('beforeend', r0);
            manipulation_1.interpolateTextNode(document.body, 'story', r1);
            console.log(relatedStoryFragmentTest(r1.relatedStories));
            manipulation_1.replaceTextNode(document.body, 'story-related', relatedStoryFragmentTest(r1.relatedStories));
          });
        });
      }
    };
  });
})("file:///D:/projects/task-suitsupply/src/core/core.ts");

})
(function(factory) {
  factory();
});