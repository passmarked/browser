const CDP           = require('chrome-remote-interface');
const ChromePage    = require('./page');
const fs            = require('fs');
const _             = require('underscore')
const EventEmitter  = require('events');
const async         = require('async');
const Constants     = require('./constants');

module.exports = exports = function(options) {

  // default with options
  options = _.extend({

    host:                 Constants.DEFAULT_HOST,
    port:                 Constants.DEFAULT_PORT,
    tabs:                 1,
    timeout:              null,
    disableCache:         options.disableCache === true,
    bypassServiceWorkers: options.bypassServiceWorkers === true,
    ignoreSSL:            true,
    clearTab:             options.clearTab === true,

    contentTypes:         [].concat(options.contentTypes || []),
    
    userAgent:            options.userAgent || null,

    cpu:                  null,
    downloadRate:         null,
    uploadRate:           null,
    latency:              null,
    offline:              false,
    userAgent:            null,
    connectionType:       null,

    width:                null,
    height:               null,
    mobile:               false,
    scale:                1,
    orientation:          null,
    fitWindow:            false,
    media:                null,

    recordEvery:          null,

    cookies:              [],

    headers:              _.extend({}, options.headers || {}),
    timeout:              options.timeout,

    currentRunCount:      10

  }, options || {});

  // add default types if non
  if(options.contentTypes.length == 0) {

    // add the defaults
    options.contentTypes = options.contentTypes.concat([

      '*'

    ]);

  }

  // create a class object
  var ChromeClient = new EventEmitter();

  /**
  * Handles actually queuing and using the newly created tab
  **/
  ChromeClient.handlePageRequest = async function(params, fn) {

    // make sure it's only called once
    var callback = params.callback;

    // return the rejection handler
    var rejectionHandler = function(err) { 

      callback(err) 
      setImmediate(fn, err);

    };

    // get the callback
    var finalCallback = _.once(function() {

      // remove the notification
      process.removeListener('unhandledRejection', rejectionHandler)

      // done
      setImmediate(fn, null);

    });

    // there seems to be a issue in the chrome-remote-interface library
    // where a rejection error is not caught
    process.addListener('unhandledRejection', rejectionHandler);

    var [tab] = await CDP.List({

      host: options.host, 
      port: options.port

    })

    if(!tab) tab = await CDP.New();
    const client = await CDP({ 

      host: options.host, 
      port: options.port, 
      target: tab 

    })

    // bootstrap the new client
    var page = ChromePage(_.extend({}, options, params, {

      instance:       client,
      url:            params.url,
      headers:        _.extend({}, options.headers, params.headers || {}),
      cookies:        (options.cookies || []).concat(params.cookies || [])

    }));
    page.startedProfile = new Date().getTime();
    page.close = async function(cb) {

      // extract what we want
      const {Page} = client;
      await Page.navigate({

        url: 'about:blank'

      });

      // done
      await page.disable();
      await client.close();
      if(cb) cb();
      finalCallback(null);

    };

    page.loaded = function() {

      setImmediate(callback, null, page);

    };

    // listen to close event
    client.on('event', function(dd) {

      if(dd && 
          [
            
            'Inspector.targetCrashed'

          ].indexOf(dd.method || '') != -1) {

        // done
        page.close(() => {

          // stop here
          setImmediate(callback, new Error(dd.method))

        });

      }

    });

    // listen to close event
    client.on('disconnect', function() {

      // done
      page.close(() => {

        // stop here
        setImmediate(callback, new Error('Closed before it started'))

      });

    });

  };

  /**
  * Create the queue that will handle connecting
  **/
  ChromeClient.queue = async.queue(function(params, fn) {

    // great pass this along
    ChromeClient.handlePageRequest(params, fn);

  }, 1);

  /**
  * Take a screenshot
  **/
  ChromeClient.load = function(params, fn) {

    // queue up the requested page load
    ChromeClient.queue.push(_.extend(params, {

      callback: fn

    }), function() {

    });

  };

  /**
  * Returns the current client instance
  **/
  ChromeClient.getInstance = function() { return this.instance; };

  // return the object
  return ChromeClient;

};
