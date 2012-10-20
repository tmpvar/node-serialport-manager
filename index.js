var
  serialport = require('serialport'),
  EventEmitter = require('events').EventEmitter,
  fs = require('fs'),
  path = require('path'),
  file = path.join(process.env.HOME, '.serialport'),
  match = require('JSONSelect').match;

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
  var managing = [];
  var e = new EventEmitter();
  options = options || {};

  var cleanup = function() {
    fs.readFile(file, function(err, buf) {
        var inuse = {};

        if (!err) {
          inuse = JSON.parse(buf.toString());
        }

        console.log(arguments)
        while (managing.length) {
          delete inuse[managing.pop()];
        }

        fs.writeFile(file, JSON.stringify(inuse), function() {
          process.exit();
        });
    });
  };

  process.on('SIGHUP', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGQUIT', cleanup);
  process.on('SIGKILL', cleanup);
  process.on('SIGTERM', cleanup);


  var timer = setInterval(function() {
    e.emit('searching');

    serialport.list(function(err, ports) {
      fs.readFile(file, function(err, buf) {
        var inuse = {};

        if (!err) {
          inuse = JSON.parse(buf.toString());
        }

        var current = ports.length;
        while (current--) {
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

            if (!match) { continue; }
          }


          // don't use this port if either are true
          // - the port is in use
          // - the user did not pass a callback
          if (!inuse[port.comName] && fn) {
            inuse[port.comName] = true;

            managing.push(port.comName);

            fs.writeFile(file, JSON.stringify(inuse), function() {

              var sp = new serialport.SerialPort(
                  port.comName,
                  options.config
              );

              if (options.header) {
                var header = "";
                sp.once('data', function nextChunk(chunk) {
                  header+=chunk.toString();

                  if (header.length < options.header.length) {
                    sp.once('data', nextChunk);
                  } else {
                    clearInterval(timer);
                    fn(sp, header);
                  }
                });
              } else {
                fn(sp);
              }
            });

            break;
          }
        }
      });
    });

  }, 500);

  return e;
};

module.exports.serialport = serialport;
