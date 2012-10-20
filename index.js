var
  serialport = require('serialport'),
  EventEmitter = require('events').EventEmitter,
  fs = require('fs'),
  file = require('path').join(process.env.HOME, '.serialport');

/*
  options

    signature : { query : value}
    header : ensure data from the sp matches before returning the sp
    config : <new SerialPort() options>

  example:

    var manager = require('serialport-manager');
    var progress = manager({
      signature : {
        manufacturer : "tmpvar"
      },
      config : {
        parser : manager.serialport.readline('\n')
      }
    }, function(sp) {
      sp.pipe(somewhere);
    });

    progress.on('searching', runSpinner);
    progress.on('found', stopSpinner);

*/

module.exports = function(options, fn) {
  var managing = {};
  var TICK_RATE = 500;
  var e = new EventEmitter();
  options = options || {};

  var cleanup = function(exit) {
    fs.readFile(file, function(err, buf) {
      var inuse = {};

      if (!err) {
        inuse = JSON.parse(buf.toString());
      }

      var keys = Object.keys(managing);

      while (keys.length) {
        var key = keys.pop();
        delete inuse[key];
        managing[key].close();
      }

      managing = {};

      fs.writeFile(file, JSON.stringify(inuse), function() {
        exit !== false && process.exit();
      });
    });
  };

  process.on('SIGHUP', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGQUIT', cleanup);
  process.on('SIGKILL', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', function(e) {
    console.log(e.stack);
    cleanup(false);
  });

  var timer;

  var search = function() {

    e.emit('searching');

    serialport.list(function(err, ports) {

      if (err || !ports) {
        return;
      }

      fs.readFile(file, function(err, buf) {

        var inuse = {};

        if (!err) {
          try {
            inuse = JSON.parse(buf.toString());
          } catch(e) {
            console.log(e.stack);
          }
        }

        var current = ports.length;
        var next = function() {

          current--;
          if (current < 0) {
            timer && clearTimeout(timer);
            timer = setTimeout(search, TICK_RATE);
            return;
          }

          var port = ports[current];

          if (options.signature) {
            var
              keys = Object.keys(options.signature),
              match = true;

            keys.forEach(function(key) {
              if (options.signature[key] !== port[key]) {
                match = false;
              }
            });

            if (!match) {
              return process.nextTick(next);
            }
          }

          // don't use this port if either are true
          // - the port is in use
          // - the user did not pass a callback
          if (!inuse[port.comName] && fn) {
            var sp;
            try {
              sp = new serialport.SerialPort(
                  port.comName,
                  options.config
              );

            } catch (e) {
              return process.nextTick(next);
            }

            sp.on('open', function() {
              // so we've got a serialport here that matches
              // the required signatures

              inuse[port.comName] = true;
              managing[port.comName] = sp;

              fs.writeFile(file, JSON.stringify(inuse), function() {
                if (options.header) {
                  var header = "";
                  sp.once('data', function nextChunk(chunk) {
                    header+=chunk.toString();

                    if (header.length < options.header.length) {
                      sp.once('data', nextChunk);
                    } else {
                      e.emit('connected');
                      fn(sp, header);
                      if (header.length > options.header) {
                        sp.emit('data', header.substring(options.header.length-1));
                      }
                    }
                  });

                } else {
                  e.emit('connected');
                  fn(sp);
                }

                e.once('disconnected', function() {
                  // restart the connection process
                  // this is separated from sp 'close' event
                  // to allow for flashing in tmpad
                  timer && clearTimeout(timer);
                  timer = setTimeout(search, TICK_RATE);
                });

                sp.on('close', function() {
                  fs.readFile(file, function(err, d) {
                    var obj = {};

                    if (!err) {
                      try {
                        obj = JSON.parse(d.toString());
                      } catch (e) {}
                    }

                    delete obj[port.comName];

                    fs.writeFile(file, JSON.stringify(obj), function() {
                      e.emit('disconnected');
                    });
                  });
                });

              });
            });

            sp.on('error', function(e) {
              process.nextTick(next);
            });
          } else {
            // not a match, try next
            process.nextTick(next);
          }
        }

        next();

      });
    });
  }

  // kick off the search immediately
  search();

  e.disableReconnect = function() {
    e.removeAllListeners('disconnected');
  }

  return e;
};

module.exports.serialport = serialport;