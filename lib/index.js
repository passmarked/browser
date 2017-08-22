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
  * Clears out the targets every now and then to ensure we 
  * don't have memory leaks
  **/
  ChromeClient.gc = function(fn) { return fn(null); }

  /**
  * Clears out the targets every now and then to ensure we 
  * don't have memory leaks
  **/
  ChromeClient.flush = function(fn) { return fn(null);

    // connect to client
    CDP({

      host:   options.host,
      port:   options.port

    }, (client) => {

      // extract what we want
      const {Target} = client;

      // create a target
      Target.getTargets()
      .then((result)=>{

        // promises to do
        var promises = [];

        // the entries
        var entries = (result || {}).targetInfos || [];

        // how many specials ?
        var specialCount = 0;

        // close targets
        for(var i = 0; i < entries.length; i++) {

          if(entries[i].url.indexOf('chrome://') === 0 ||  
              entries[i].url.indexOf('about://') === 0) {

            // increment
            specialCount++;

            // only if this is the first ?
            if(specialCount == 1) {

              // check if open
              continue;

            }

          }

          promises.push(Target.closeTarget({

            targetId: entries[i].targetId

          }))

        }

        // check if done
        if(promises.length == 0) return fn(null);

        Promises.all(promises)
        .then(() => {

          // then close it
          // client.close()

          // done
          fn(null);

        })
        .catch((err)=>{

          // then close it
          // client.close()

          // done
          fn(err);

        })

      })
      .catch((err)=>{

        // then close it
        client.close()

        // finish up
        fn(err);

      })

    });

  };

  /**
  * Handles actually queuing and using the newly created tab
  **/
  ChromeClient.handlePageRequest = function(targetid, params, fn) {

    // get the callback
    var finalCallback = _.once(fn);

    // make sure it's only called once
    var callback = _.once(params.callback);

    // connect to client
    CDP({

      host:   options.host,
      port:   options.port,
      target: targetid

    }, (client) => {

      // listen to close event
      client.on('close', function() {

        // stop here
        callback(null, {})

        try {

          // disable the page
          page.disable();

        } catch(err) {}

        // done
        finalCallback(null);

      });

      // bootstrap the new client
      var page = ChromePage(_.extend({}, options, params, {

        instance:       client,
        url:            params.url,
        headers:        _.extend({}, options.headers, params.headers || {}),
        cookies:        (options.cookies || []).concat(params.cookies || [])

      }));
      page.exit = function(cb) {

        try {

          // close the target
          Chrome.Close({

            host:     options.host,
            port:     options.port,
            id:       targetid

          })
          .then(function() {

            finalCallback(null);
            cb(null);

          })
          .catch(function() {

            finalCallback(null);
            cb(null);

          })

        } catch(err){

          finalCallback(err);
          cb(null);

        }

      };
      page.close = function(cb) {

        // close the page
        page.disable(function() {

          // close it
          page.exit(cb || function(){});   

        });

      };

      page.loaded = function() {

        // return the page
        callback(null, page);

      };

    });

  };

  /**
  * Create the queue that will handle connecting
  **/
  ChromeClient.queue = async.queue(function(params, fn) {

    // make sure it's only called once
    var callback = _.once(params.callback);

    // return the rejection handler
    var rejectionHandler = function(err) { 

      callback(err) 

    };

    // there seems to be a issue in the chrome-remote-interface library
    // where a rejection error is not caught
    process.once('unhandledRejection', rejectionHandler);

    // create a new target
    CDP.New({

      host:   options.host,
      port:   options.port,
      url:    'about:blank'

    }, function (err, target) {

      // remove the notification
      process.removeListener('unhandledRejection', rejectionHandler)

      // check for a error
      if(err) {

        // return it
        callback(err);
        return fn(err);

      }

      // great pass this along
      ChromeClient.handlePageRequest(target.id, params, fn);

    });

  }, options.tabs);

  /**
  * Take a screenshot
  **/
  ChromeClient.load = function(params, fn) {

    // queue up the requested page load
    ChromeClient.queue.push(_.extend(params, {

      callback: fn

    }));

  };

  /**
  * Returns the current client instance
  **/
  ChromeClient.getInstance = function() { return this.instance; };

  // return the object
  return ChromeClient;

};
