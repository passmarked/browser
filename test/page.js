// modules
const assert      = require('assert');
const _           = require('underscore');
const fs          = require('fs');
const Browser     = require('../index.js');

// handle the settings
describe('browser', function() {

  this.timeout(10000);

  describe('exec', function() {

    // handle the error output
    it('Should exececute blank function without error -- nothing is returned', function(done) {

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

        page.exec(function() { return 0; }, {}, function(err, exception, value) {

          page.close();
          if(err) assert.fail("Was not expecting a error");
          if(value !== 0) assert.fail("Should return 0")

          done();

        });

      });

    });

  });
  
});
