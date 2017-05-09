const async = require('async');
const ChromeClient = require('./index.js')
const fs = require('fs');
var client = ChromeClient({

  host: 'localhost',
  port: 9222,
  tabs: 1 // how many tabs to open at once while processing

});

async.each([

  'http://example.com',
  'http://facebook.com',
  'http://google.com',
  'http://passmarked.com'

], function(url, cb) {

  // debug
  console.log('loading: ' + url);

  client.load({

    url:            url

  }, function(err, page) {

    // are we connected ?
    if(err) {

      // nope ...
      console.log('failed to connect');
      console.dir(err)
      cb(err);
      return;

    }

    var result = page.getResult();

    console.log('result: ' + result)

    if(result != 'success') {

      // mmmmm ....
      console.log('could not load the page ...');

      // close
      page.close();

      // finish up
      return cb(null);

    }

    // close
    page.close();

    cb(null);

  });

}, function() {

  console.log('done!');

});