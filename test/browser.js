// modules
const assert      = require('assert');
const _           = require('underscore');
const fs          = require('fs');
const Browser     = require('../index.js');

// handle the settings
describe('browser', function() {

  this.timeout(5000);

  // handle the error output
  it('Should give a error if not able to connect', function(done) {

    // create a fake browser
    var browser = Browser({

      host:   'localhost',
      port:   8000

    });

    // try to load
    browser.load({

      url: 'http://example.com'

    }, function(err, page) {

      if(!err) assert.fail("Was expecting error");

      if(page) page.close();
      if(page) assert.fail("No page instance should be provided");
      done();

    });

  });

  // handle the error output
  it('Should default to localhost and port 9222', function(done) {

    // create a fake browser
    var browser = Browser({});

    // try to load
    browser.load({

      url: 'http://example.com'

    }, function(err, page) {

      if(page) page.close();
      if(err) assert.fail("Was not expecting error");
      if(!page) assert.fail('Page must be defined ...');
      page.close();
      if(!page) assert.fail("No page instance was provided");
      done();

    });

  });

  // handle the error output
  it('Should give a error if correctly connected and closed', function(done) {

    // create a fake browser
    var browser = Browser({

      host:   'localhost',
      port:   9222

    });

    // try to load
    browser.load({

      url: 'http://example.com'

    }, function(err, page) {
      
      if(err) assert.fail("Was not expecting error");
      if(!page) assert.fail('Page must be defined ...');
      page.close();
      if(!page) assert.fail("No page instance was provided");
      done();

    });

  });
  
});
