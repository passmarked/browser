const _               = require('underscore')
const async           = require('async');
const hexRgb          = require('hex-rgb')
const uuid            = require('node-uuid');
const EventEmitter    = require('events');

module.exports = exports = function(options) {
  
  // create a class object
  var ChromePage = new EventEmitter();

  // the local instance
  var instance = options.instance;

  /**
  * Internal vars
  **/
  var VARS = {

    requests:       {},
    requestCount:   0,

    dialogs:        [],
    log:            [],
    websockets:     [],
    frames:         [],
    size:           0,
    transferSize:   0,
    duration:       0,
    started:        null,
    documents:      [],
    document:       null,
    timing:         null,

    filmstrip:      [],
    timer:          null,
    timeoutTimer:   null,
    currentStep:    0,
    firstRequest:   null,
    lastRequest:    null,

    loadtime:       0,

    result:         null,

    timingKeys:     [

      'connect',
      'domContentLoadedEvent',
      'domainLookup',
      'request',
      'response',
      'loadEvent',
      'redirect'

    ]

  };

  // extract what we want
  const {Security, Input, Emulation, Runtime, Console, Network, Page} = instance;

  /**
  * All done
  **/
  ChromePage.disable = function(fn) {

    // stop all timers
    if(VARS.timeoutTimer) clearTimeout(VARS.timeoutTimer);

    // stop all timers
    if(VARS.timer) clearInterval(VARS.timer);

    Promise.all([

      Network.disable(),
      Security.disable(),
      Page.disable(),
      Runtime.disable(),
      Console.disable(),

      // stop all resources as well
      Page.stopLoading()

    ])
    .then(() => {

      fn(null);

    }).catch((err) => {

      fn(null);

    });

  };

  /**
  * Aggregates the timing information
  **/
  ChromePage.aggreateTimingInformation = function(params) {

    // get all the values to aggregate
    for(var i = 0; i < VARS.timingKeys.length; i++) {

      // get the diff
      var diff = ChromePage.diffFromStartEnd(params, VARS.timingKeys[i]);

      // check if already defined ?
      if(VARS.timing[VARS.timingKeys[i]]) {

        // check if bigger than 0
        if(diff <= 0) continue;

        // increment
        VARS.timing[ VARS.timingKeys[i] ] = VARS.timing[ VARS.timingKeys[i] ] + diff;

      } else {

        // just set it
        VARS.timing[ VARS.timingKeys[i] ] = diff;

      }

    }

  };

  /**
  * Aggregates information on the based on start and end
  **/
  ChromePage.diffFromStartEnd = function(params, key) {

    // get the values
    var start   = params[key + 'Start'] || -1;
    var end     = params[key + 'End']   || -1;

    // are both undefined ?
    if(start < 0 && end < 0) return -1;
    else {

      return end - start;

    }

  };

  /**
  * Bootstrap with the instance
  **/
  ChromePage.bootstrap = function() {

    // setup handlers
    Network.requestWillBeSent((params) => {

      VARS.requests[params.requestId] = {}
      VARS.requests[params.requestId].type = params.type;
      VARS.requests[params.requestId].id = params.requestId;
      VARS.requests[params.requestId].request = params.request;
      VARS.requests[params.requestId].size = 0;
      VARS.requests[params.requestId].responseLength = 0;
      VARS.requests[params.requestId].transferSize = 0;
      VARS.requests[params.requestId].initiator = params.initiator
      VARS.requests[params.requestId].created = new Date().getTime();
      VARS.requestCount += 1

      // check if we did not have the doc
      if(!VARS.document) {

        if(params.type == 'Document' && 
            (params.initiator || {}).type == 'script') {

          // add it to the list
          VARS.documents.push({

            type:     'client',
            url:      params.request.url

          })

        } else if(params.type == 'Document' && 
            (params.initiator || {}).type == 'other') {

          // add it to the list
          VARS.documents.push({

            type:     'server',
            url:      params.request.url

          })

        }

      }

    });
    
    // Disabled as we don't need it for now
    Network.dataReceived(({requestId, dataLength}) => {
        const entry = VARS.requests[requestId];
        if (!entry) {
            return;
        }
        entry.responseLength += dataLength;
    });

    Network.loadingFinished(async ({requestId, timestamp, encodedDataLength}) => {
      const entry = VARS.requests[requestId];
      if (!entry) {
          return;
      }
      
      try {
        
        const params = await Network.getResponseBody({requestId});
        const {body, base64Encoded} = params;
        entry.responseBody = body;
        entry.responseBodyIsBase64 = base64Encoded;

      } catch (err) {
        
        // reject(err);

      }

      VARS.size += encodedDataLength || 0;
      entry.size += encodedDataLength || 0;

      entry.resolved = new Date().getTime();
      entry.duration = entry.resolved - entry.created;
      VARS.duration = (VARS.duration || 0) + entry.duration;

    });

    Network.responseReceived(function(params) {

      // the resource
      var resource = VARS.requests[params.requestId];

      resource.response = params.response;
      resource.type = params.type;

      var size = 0;
      try {

        size = parseFloat(params.response.headers['content-length'] || 0)

      } catch(err) {}

      VARS.size += resource.responseLength || size;
      resource.size += resource.responseLength || size;

      VARS.transferSize += params.response.encodedDataLength || 0;
      resource.transferSize += params.response.encodedDataLength || 0;

      if(params.type == 'Document' && 
          (resource.initiator || {}).type == 'other' &&
            (params.response || {}).status == 200 && 
              !VARS.document) {

        // set the document
        VARS.document = resource;

      }

      // check if this response has timing information
      if((params.response || {}).timing) {

        // check if timing has been defined already ?
        if(!VARS.timing) VARS.timing = {};

        // aggreate the info
        ChromePage.aggreateTimingInformation(params.response.timing);

        // increment waiting time
        VARS.timing.waiting = (VARS.timing.waiting || 0) + resource.duration;

      }

      // check if this is the first request ?
      if(!VARS.firstRequest) VARS.firstRequest = resource;

      // and set as the last request
      if(!VARS.lastRequest) VARS.lastRequest = resource;
      else if(params.timestamp > VARS.lastRequest.timestamp) {

        // set
        VARS.lastRequest = resource;

      }

    });
    
    Page.loadEventFired(() => {

      // stop capturing steps
      if(VARS.timer) clearInterval(VARS.timer);

      // set ended
      VARS.ended = new Date();

      // did we find a document ... ?
      if(!VARS.document) {

        // nope ..
        return ChromePage.end({

          result:   'failed'

        });

      }

      // set the duration
      VARS.duration = VARS.lastRequest.timestamp - VARS.firstRequest.timestamp;

      // params to return
      var resultingParams = {

        result:     'success'

      };

      // call steps the final time
      if(options.recordEvery) {

        // do a final step
        return ChromePage.captureStep(function() {

          // then finsih
          ChromePage.end(resultingParams);

        });

      }

      // run as loaded
      ChromePage.end(resultingParams);
        
    });

    instance.on('error', function (message) {
        
    });

    instance.on('close', function (message) {
        
    });

    instance.on('Page.javascriptDialogOpening', function(params) {

      // add to the list
      VARS.alerts.push({

        created:  new Date().getTime(),
        message:  params.message || '',
        type:     params.type

      });

      // response
      var response = {

        accept:       true

      };

      // report back
      if(params.type == 'prompt') {

        // should we handle this dialog ?
        if(options.prompt) {

          var userPrompt        = options.prompt(message);
          response.accept       = userPrompt.accept === true;
          response.promptText   = userPrompt.message || '';

        } else {

          response.promptText   = userPrompt.message || '¯\\_(ツ)_/¯';

        }

      }

      // handle the dialog
      Page.handleJavaScriptDialog(response)
      .then(()=>{})
      .catch((err)=>{

        // console.dir(err)

      })

    });

    instance.on('Network.webSocketFrameReceived', function(params) {

      // add to the list
      VARS.frames.push(_.extend({

        direction:  'received'

      }, params));

    });

    instance.on('Network.webSocketFrameSent', function(params) {

      // add to the list
      VARS.frames.push(_.extend({

        direction:  'sent'

      }, params));

    });

    instance.on('Network.webSocketCreated', function(params) {

      // add to the list
      VARS.websockets.push(params);

    });

    instance.on('Console.messageAdded', function(params) {

      // add to the list
      VARS.log.push(params);

    });

    instance.on('Security.certificateError', function(params) {

      if(options.ignoreSSL === true) {

        Security.handleCertificateError({

          eventId: params.eventId,
          action: 'continue'

        })
        .then(()=>{})
        .catch((err)=>{

          // console.dir(err)

        })

      } else {

        ChromePage.end({

          result:   'insecure'

        });

      }

    });

    var promises = [];
    promises.push(Runtime.enable())
    promises.push(Network.enable())
    promises.push(Page.enable())
    promises.push(Console.enable())
    promises.push(Emulation.clearDeviceMetricsOverride());
    if(options.disableCache === true) {
      promises.push(Network.setCacheDisabled({

        cacheDisabled: true

      }))
      promises.push(Network.clearBrowserCache())
    } else {
      promises.push(Network.setCacheDisabled({

        cacheDisabled: false

      }))
    }

    // should we override the user agent ?
    if(options.userAgent) {
      promises.push(Network.setUserAgentOverride({

        userAgent: options.userAgent

      }))
    }

    // set the headers
    if(options.headers) {
      promises.push(Network.setExtraHTTPHeaders({

        headers: options.headers || {}

      }))
    }

    // should we allow service workers ... ?
    if(options.bypassServiceWorkers === true) {
      promises.push(Network.setBypassServiceWorker({

        bypass: true

      }))
    }

    if(options.background) {

      var decoded = hexRgb(options.background);

      promises.push(Emulation.setDefaultBackgroundColorOverride({

        color: {

          r:  decoded[0],
          g:  decoded[1],
          b:  decoded[2],
          a:  1

        }

      }))

    }

    if(options.downloadRate || 
        options.uploadRate || 
          options.latency || 
            options.offline != false || 
              options.connectionType) {


      // build up the options
      var networkOptions = {

        offline:              options.offline === true,
        latency:              options.latency || 0,
        downloadThroughput:   options.uploadRate || 100000,
        uploadThroughput:     options.downloadRate || 100000

      };

      // check if a type was given ?
      if(options.connectionType) {

        // set the type
        networkOptions.connectionType = options.connectionType;

      }

      // emulate the conditions !
      promises.push(Network.emulateNetworkConditions(networkOptions))

    }

    promises.push(Security.enable())
    promises.push(Security.setOverrideCertificateErrors({

      override: true

    }))
    promises.push(Emulation.setVirtualTimePolicy({

      policy: 'advance'

    }))

    if(options.userAgent) {
      promises.push(Network.setUserAgentOverride({

        userAgent: options.userAgent

      }))
    }

    if(options.lat && options.lon) {
      promises.push(Emulation.setGeolocationOverride({

        latitude:   options.lat,
        longitude:  options.lon

      }))
    }

    // configure and then start
    Promise.all(promises)
    .then(() => {

      // options to navigate to
      var navigateOptions = {

        url: options.url

      };

      // check if a referrer was given ?
      if(options.referrer) {

        // set it
        navigateOptions.referrer = options.referrer;

      }

      // start tracking when the page started
      VARS.started = new Date();

      // start tracking
      if(options.timeout) {

        // start timer
        VARS.timeoutTimer = setTimeout(function() {

          // timeout now
          ChromePage.end({

            result:     'timeout'

          })

        }, options.timeout);

      }

      // hit "enter" and load the page
      return Page.navigate(navigateOptions);

    }).catch((err) => {

      // output the error
      console.dir(err)

      // close it all
      ChromePage.close();

    });

  };

  /**
  * Executes Javascript code in the context of the page
  **/
  ChromePage.exec = function(codeToExec, arguments, fn) {

    var execWrapper = '(' + codeToExec.toString() + ')(' + JSON.stringify(arguments || {}) + ')';

    Runtime.compileScript({

      expression:     execWrapper,
      sourceURL:      '',
      persistScript:  true

    })
    .then((compiledScript)=>{

      if(!compiledScript) return fn(new Error('Script could not be compiled ...'))

      Runtime.runScript({

        scriptId: compiledScript.scriptId,
        returnByValue: true

      })
      .then((params)=>{

        fn(params.exceptionDetails || null, (params.result || {}).value);

      })
      .catch((err)=>{

        fn(err);

      })      

    })
    .catch((err)=>{

      fn(err);

    })

  };

  /**
  * Returns the content of the page
  **/
  ChromePage.getContent = function(rendered, fn) {

    // should we return the server side content ?
    if(rendered === false) {

      // get the document HAR item
      return ChromePage.getDocument(function(err, document) {

        // did we get the document ?
        if(err) {

          // stop here
          return fn(new Error('Something went wrong while trying to get the document content for #getContent'))

        }

        // did we get the document ?
        if(!document) {

          // stop here
          return fn(new Error('Problem getting the document, no document was returned ...'))

        }

        // done
        return fn(null, document);

      });

    }

    // just return the messages we have been tracking
    return ChromePage.exec(function() {

      return ((document || {}).documentElement || {}).outerHTML || '';

    }, {}, fn);
    
  };

  /**
  * Returns the memory usage from the page
  **/
  ChromePage.getMemoryUsage = function(fn) {

    // just return the messages we have been tracking
    return ChromePage.exec(function() {

      return ((window.performance || {}).memory || {}).usedJSHeapSize || 0;

    }, {}, fn);

  };

  /**
  * Returns the title of the page
  **/
  ChromePage.getTitle = function(fn) {

    // just return the messages we have been tracking
    return ChromePage.exec(function() {

      return document.title;

    }, {}, fn);

  };

  /**
  * Returns the final url from the page
  **/
  ChromePage.getURL = function(fn) {

    // just return the messages we have been tracking
    return ChromePage.exec(function() {

      return document.location.toString();

    }, {}, fn);

  };

  /**
  * Returns track websocket frames
  **/
  ChromePage.getTrackedWebsocketFrames = function(fn) {

    // just return the messages we have been tracking
    fn(null, VARS.frames || []);

  };

  /**
  * Returns websocket open events from the page
  **/
  ChromePage.getTrackedWebsockets = function(fn) {

    // just return the messages we have been tracking
    fn(null, VARS.websockets || []);

  };

  /**
  * Returns the console log for the page
  **/
  ChromePage.getConsoleMessages = function(fn) {

    // just return the messages we have been tracking
    fn(null, VARS.log || []);

  };

  /**
  * Returns any dialogs that opened up on the page
  **/
  ChromePage.getJavascriptDialogs = function(fn) {

    // just return the messages we have been tracking
    fn(null, VARS.log || []);

  };

  /**
  * Returns a screenshot
  **/
  ChromePage.getNavigationHistory = function(fn) {

    Page.getNavigationHistory()
    .then((result) => {

      // entries to return
      var len = (result.entries || []).length;
      var entries = (result.entries || []).slice(1, len);

      // return the entries
      fn(null, entries)

    })
    .catch(()=>{

      fn(err);

    })

  };

  /**
  * Returns a screenshot
  **/
  ChromePage.getDocuments = function(fn) {

    // send it back
    fn(null, VARS.documents || []);

  };

  /**
  * Returns a screenshot
  **/
  ChromePage.getDocument = function(fn) {

    // send it back
    ChromePage.getHarItem((VARS.document || {}).id || null, fn)

  };

  /**
  * Returns the timing information for the entire page with all resources,
  * else if request id is given. Returns timing for a specific resource
  **/
  ChromePage.getTiming = function(requestid, fn) {

    // do we want this for a specific request ?
    if(requestid && typeof requestid !== 'function') {

      var timing = null;
      var entry = VARS.requests[ requestid ];
      if(entry && 
          entry.response && 
            entry.response.timing) {

        // give them timing back
        timing = entry.response.timing;

      }
      fn(null, timing)

    } else {

      // override function
      fn = requestid;

      // return the timing
      fn(null, VARS.timing || null);

    }

  };

  /**
  * Returns the steps captured in the filmstrip
  **/
  ChromePage.getSteps = function(fn) {

    // return the duration
    fn(null, VARS.filmstrip || []);

  };

  /**
  * Returns the requests of the page
  **/
  ChromePage.getRequests = function(fn) {

    // return the duration
    fn(null, _.values(VARS.requests || {}));

  };

  /**
  * Returns the total size of the page loaded
  **/
  ChromePage.getRequestCount = function(fn) {

    // return the duration
    fn(null, VARS.requestCount || 0);

  };

  /**
  * Returns the total size of the page loaded
  **/
  ChromePage.getSize = function(fn) {

    // return the duration
    fn(null, VARS.size || 0);

  };

  /**
  * Returns the loadtime of the page
  **/
  ChromePage.getDuration = function(fn) {

    // return the duration
    fn(null, VARS.duration || 0);

  };

  /**
  * Returns timing for the page itself
  **/
  ChromePage.getTimingOfDocument = function(fn) {

    ChromePage.getDocument(function(err, doc) {

      // return error and timing information
      fn(err, (doc || {}).response.timing || null);

    });

  };

  /**
  * Handles setting emulation information
  **/
  ChromePage.emulate = function(params, fn) {

    // add to clear any other emulation
    return Emulation.clearDeviceMetricsOverride()
    .then(()=>{

      var promises = [];

      // set the metrics
      var metricConfig = {

        width:                params.width || options.width || 1280,
        height:               params.height || options.height || 800,
        mobile:               params.mobile === true || options.mobile === true,
        fitWindow:            true

      };

      // set the scale
      metricConfig.deviceScaleFactor = 1.0 * (params.scale || options.scale);
      if(metricConfig.deviceScaleFactor === NaN ||   
          metricConfig.deviceScaleFactor === null || 
            metricConfig.deviceScaleFactor === undefined) {

        metricConfig.deviceScaleFactor = 1;

      }
      metricConfig.deviceScaleFactor = parseFloat(metricConfig.deviceScaleFactor)

      if(options.orientation) {

        // set it 
        metricConfig.screenOrientation = options.orientation;

      }

      promises.push(Emulation.setVisibleSize({

        width:                params.width || options.width || 1280,
        height:               params.height || options.height || 800

      }));

      promises.push(Emulation.setDeviceMetricsOverride(metricConfig))

      if(params.media) {

        promises.push(Emulation.setEmulatedMedia({

          media:  params.media

        }))

      }

      if(promises.length == 0) return fn(null);

      return Promises.all(promises)
      .then(()=>{

        fn(null);

      })
      .catch((err)=>{

        // done
        fn(err);

      })

    })
    .catch((err)=>{

      // done
      fn(err);

    })

  };

  /**
  * Handles page loaded details
  **/
  ChromePage.end = function(params) {

    // skip first end
    if(!params.result) return;

    // set the result
    VARS.result = params.result || 'error';

    // finish up
    ChromePage.loaded()

  };

  /**
  * Returns the headers in array from map given
  **/
  ChromePage.getHARHeaderInArray = function(headers) {

    var entries = [];
    for(var header in headers) {

      entries.push({

        name: header,
        value: headers[header],
        comment: ''

      });

    }
    return entries;

  };

  /**
  * Builds a log item from the resource id
  **/
  ChromePage.getHarItem = function(requestId, fn) {

    // get the resources
    var resource = VARS.requests[requestId] || null;

    // check the resource
    if(!resource) return fn(null);

    // set local variables
    var response  = resource.response;
    var request   = resource.request;

    // check the resource
    if(!request) {

      return fn(null);

    }
    if(!response) {

      return fn(null);

    }

    // the entry to return
    var entry = {

      "startedDateTime": resource.created.toString(),
      "time": 50,
      "request": {

        "method": request.method,
        "url": request.url,
        "httpVersion": "HTTP/1.1",
        "cookies": [],
        "headers": ChromePage.getHARHeaderInArray(resource.request.headers || []),
        "queryString" : [],
        "postData" : {},
        "headersSize" : 150,
        "bodySize" : 0,
        "comment" : ""

      },
      "response": {

        "status": response.status,
        "statusText": response.statusText,
        "httpVersion": response.protocol,
        "cookies": [],
        "headers": ChromePage.getHARHeaderInArray(resource.response.headers || []),
        "content": {},
        "redirectURL": "",
        "headersSize" : 160,
        "bodySize" : resource.size,
        "comment" : "",
        "content": {

          "size": resource.responseLength,
          "mimeType": '',
          "compression": response.compression,
          "text": '',
          "encoding": ''

        }

      },
      "timing": response.timing,
      "cache": {},
      "timings": response.timing,
      "serverIPAddress": response.remoteIPAddress,
      "connection": response.connectionId,
      "comment": ""

    };

    // done
    fn(null, entry)

  };

  /**
  * Returns a generated HAR from the context
  **/
  ChromePage.getHAR = function(fn) {

    // loop the requests
    var resourceIds = _.keys(VARS.requests);

    // the resulting har
    var har = {

      "log": {
      
        "version" : "1.2",
        "creator" : {},
        "browser" : {},
        "pages": [],
        "entries": [],
        "comment": ""

      }

    };

    // loop it
    async.eachLimit(resourceIds, 1, function(resourceId, cb) {

      // get the entry
      ChromePage.getHarItem(resourceId, function(err, item) {

        if(item) har.log.entries.push(item);
        cb(null);

      });

    }, function() {

      // just return it
      fn(null, har);

    });

  };

  /**
  * Returns the result of trying to load the page
  **/
  ChromePage.getResult = function() {

    // just return it
    return VARS.result;

  };

  /**
  * Render a screenshot
  **/
  ChromePage.render = function(params, fn) {

    // first try to emulate if any
    ChromePage.emulate(params, function(){

      // create the callback
      var callback = _.once(fn);

      // righto check format
      if(params.format === 'pdf') {

        // output as PDF
        Page.printToPDF()
        .then((result)=>{

          callback(null, new Buffer(result.data, 'base64'))

        })
        .catch((err)=>{

          callback(err)

        })

      } else if(params.format == 'png') {

        // output as PDF
        Page.captureScreenshot('png')
        .then((result)=>{

          callback(null, new Buffer(result.data, 'base64'))

        })
        .catch((err)=>{

          callback(err)

        })

      } else {

        // output as PDF
        Page.captureScreenshot('jpeg', params.quality || 30)
        .then((result)=>{

          callback(null, new Buffer(result.data, 'base64'))

        })
        .catch((err)=>{

          console.dir(err)

          callback(err)

        })

      }

    });

  };

  /**
  * Captures a "step"
  **/
  ChromePage.captureStep = function(fn) {

    // the page must have started already
    if(!VARS.started) return;

    // increment the step
    VARS.currentStep += 1

    // create the step
    var step = {

      delay:    new Date().getTime() - VARS.started.getTime(),
      index:    VARS.currentStep,
      uid:      uuid.v1()

    };

    // get the screenshot
    ChromePage.render({

      format:   'jpeg',
      quality:  30

    }, function(err, buf) {

      // set the data
      step.data = buf;

      // add to steps
      VARS.filmstrip.push(step);

      // done
      if(fn) fn(err, buf);

    });

  };

  // check if we should do the timeout
  if(options.recordEvery) {

    // time a timer
    VARS.timer = setInterval(ChromePage.captureStep, options.recordEvery);

  }

  // run the bootstrapper
  ChromePage.bootstrap();

  // return the object
  return ChromePage;

};
