// Gotta start somewhere !
const fs = require('fs');
const Browser = require('@passmarked/browser')

/** 
* Create a client context that will be used to access
* the remote browser instance. Supplying the host
* and port of the remote instance to connect to.
**/

var client = Browser({

  host:    'localhost', // default host
  port:    9222, // default port

});

/**
* Load a page with the specified url and options.
* See #Options for all possible config options.
**/

client.load({

  url: 'http://example.com',
  background: '#fff', // default background to white
  timeout: 30 * 1000 // 30 second timeout

}, function(err, page) {

  // check for an error related to the remote instance connection
  if(err) {
  
    // debugging message
    console.log('failed to connect');
    
    // output the error
    console.dir(err);
    
    // done
    return;
  
  }
  
  // get the result of the connection
  var result = page.getResult();
  
  // check if we were able to load
  if(result != 'success') {
  
    // output the result
    console.log('Problem loading page: ' + result);
    
    // close the page context to allow next page
    // to run in queue -- see #tabs under #Options
    page.close();
    
    // finish up
    return;
  
  }
  
  // render pdf
  page.getHAR(function(err, har) {
  
    // done
    console.dir(har);

    // close the context
    page.close();
  
  });
  
});