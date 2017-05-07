const Chrome = require('chrome-remote-interface');
const ChromePage = require('./page');
const fs = require('fs');
const _ = require('underscore')
const EventEmitter = require('events');
const async = require('async');

module.exports = exports = function(options) {

  // default with options
  options = _.extend({

    tabs:                 1,
    timeout:              null,
    disableCache:         options.disableCache === true,
    bypassServiceWorkers: options.bypassServiceWorkers === true,
    ignoreSSL:            true,

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
  ChromeClient.flush = function(fn) {

    // connect to client
    var scopedClient = Chrome({

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

        // close targets
        for(var i = 0; i < entries.length; i++) {

          if(entries[i].url.indexOf('chrome://') === 0 ||  
              entries[i].url.indexOf('about://') === 0)
                continue;

          promises.push(Target.closeTarget({

            targetId: entries[i].targetId

          }))

        }

        Promises.all(promises)
        .then(() => {

          // then close it
          client.close()

          // done
          fn(null);

        })
        .catch((err)=>{

          // then close it
          client.close()

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

    // make sure it's only called once
    var callback = params.callback;

    // connect to client
    var scopedClient = Chrome({

      host:   options.host,
      port:   options.port,
      target: function(targets) {

        // check all the targets
        for(var i = 0; i < targets.length; i++) {

          // check for a matching id
          if(targets[i].id == targetid) {

            // then return it !
            return targets[i];

          }

        }

        // else return null
        return null;

      }

    }, (client) => {

      // listen to close event
      client.on('close', function() {

        // stop here
        callback(null, {



        })

        // disable the page
        page.disable();

        // done
        fn(null);

      });

      // bootstrap the new client
      var page = ChromePage(_.extend({}, options, params, {

        instance:       client,
        url:            params.url,
        headers:        _.extend({}, options.headers, params.headers || {}),
        cookies:        (options.cookies || []).concat(params.cookies || [])

      }));
      page.exit = function(cb) {

        // close the target
        Chrome.Close({

          host:     options.host,
          port:     options.port,
          id:       targetid

        })
        .then(function() {

          console.log('closed');
          fn(null);
          if(cb) cb(null);

        })
        .catch(function() {

          console.log('closed');
          fn(null);
          if(cb) cb(null);

        })

      };
      page.close = function(cb) {

        // close the page
        page.disable();

        // totally close the page and client
        page.exit(cb);          

      };

      page.loaded = function() {

        // return the page
        callback(null, page);

      };

    });

    scopedClient.on('error', function(err) {

      // output the error
      callback(err);

      // totally close the page and client
      page.exit();

    });

  };

  /**
  * Create the queue that will handle connecting
  **/
  ChromeClient.queue = async.queue(function(params, fn) {

    // make sure it's only called once
    var callback = params.callback;

    // connect to client
    var scopedClient = Chrome({

      host:   options.host,
      port:   options.port

    }, (client) => {

      // extract what we want
      const {Target} = client;

      // create a target
      Target.createTarget({

        url:    'about:blank'

      })
      .then((result)=>{

        // then close it
        client.close()

        // great pass this along
        ChromeClient.handlePageRequest(result.targetId, params, fn);

      })
      .catch((err)=>{

        // then close it
        client.close()

        // return it
        callback(err);

        // finish up
        return fn();

      })

    });

    /** 

    // create a new target
    Chrome.New({

      host:   options.host,
      port:   options.port,
      url:    'about:blank'

    }, function (err, target) {

      // check for a error
      if(err) {

        // return it
        callback(err);
        return fn();

      }

      // great pass this along
      ChromeClient.handlePageRequest(target, params, fn);

    }); **/

  }, options.tabs);

  /**
  * Take a screenshot
  **/
  ChromeClient.load = function(params, fn) {

    // do a cleanup of targets
    ChromeClient.gc(function() {

      // queue up the requested page load
      ChromeClient.queue.push(_.extend(params, {

        callback: fn

      }), function() {

        // done, just move on to next...

      });

    });

  };

  /**
  * Returns the current client instance
  **/
  ChromeClient.getInstance = function() { return this.instance; };

  /**
  * When everything calms down, close all the tabs
  **/
  ChromeClient.queue.drain = function() {

    ChromeClient.flush(function() {

      // flushed !!

    });

  };

  // return the object
  return ChromeClient;

};
