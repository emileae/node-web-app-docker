// node built-in
const https = require('https');// need this in the /upload_file_url
const fs = require('fs');
const path = require('path');

// express
const express = require('express');

// rabbitmq client
// const amqp = require('amqplib/callback_api');
const amqp = require('amqplib');

// npm libs
var bodyParser = require('body-parser')
const formidable = require('formidable');
const axios = require('axios');

const app = express();

const PORT = 3000;
const HOST = '0.0.0.0';

// Volume path
const volumePath = "/site/case"; // path.join(__dirname, '/data/node');

var handleError = (err) => {
  console.log("ERROR: ", err);
}

//docker run -p 49160:8080 -d emiru84/node-web-app
// the 172.17.0.2 --> is found when doing a docker inspect on the rabbitmq container
// seems to work since it starts listening
// trying to find how to trigger the running node... doesnt seem to work on locahost

const rabbitHost = process.env.RABBIT_IP || "rabbit";//"172.18.0.2";//"localhost";// rabbitmq'd docker host, I dont think this has anything to do with the container ip
console.log("Connect to rabbit host: ", rabbitHost);

// Enable CORS
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(bodyParser.json());

function generateUuid() {
  return Math.random().toString() +
         Math.random().toString() +
         Math.random().toString();
}

// RabbitMQ
const connectToRabbit = () => {
  return amqp.connect(`amqp://${rabbitHost}`, function(err, conn) {
    if (conn){
      return conn;
    }else{
      throw "couldn't connect to RabbitMQ conn is falsy";
      console.log(`couldn't connect to RabbitMQ`);
      return undefined;
    }

  });
}

// conn: provide a cpnnection to the rabbit server, use connectToRabbit()
// q:  provide a q = the rabbit queue name/string
// message: provide the message to send via rabbit
const sendRabbitMessage = (conn, q, message) => {
  console.log("sending rabbit message");
  conn.createChannel()
  .then((ch)=>{

    var ex = 'inputchanges';
    var routing_key = 'FlowScopeConsumer';

    ch.assertExchange(ex, 'direct', {durable: true});

    // Sending directly to a queue
    // ch.assertQueue(q, {durable: true});// durable was false
    // Note: on Node 6 Buffer.from(msg) should be used
    // ch.sendToQueue(q, new Buffer(message));

    var corr = generateUuid();

    // sending to an exchange
    // replyTo is the name of the queue that is listening
    ch.publish(ex, routing_key, new Buffer(message), { correlationId: corr, replyTo: 'FLOWSCOPE_RESULTS' });

    console.log(`[x] Sent ${message} on queue ${q}`);
  }).catch((err)=>{
    console.log("error sendRabbitMessage: ", err);
  })

  // conn.createChannel(function(err, ch) {
  //   ch.assertQueue(q, {durable: false});
  //   // Note: on Node 6 Buffer.from(msg) should be used
  //   ch.sendToQueue(q, new Buffer(rabbitMessage));
  //   console.log(" [x] Sent %s", rabbitMessage);
  // });

  setTimeout(function() {
    conn.close();
  }, 500);
}

const connectAndSendRabbitMessage = (message, q) => {
  console.log("... trying to connect to rabbit server");
  connectToRabbit()
  .then((conn)=>{
    if (conn){
      console.log("connected to rabbit!");
      sendRabbitMessage(conn, q, message);
    }else{
      console.log("There was no connection");
    }
  }).catch((err)=>{
    console.log("error: ", err);
  })
}
const triggerResultExport = () => {

  console.log("triggering export...");

  var ex = 'result_trigger';
  var q = 'result_file_path';
  var msg = '/site/case/ExampleWell1.h5';// this should be the path according to the volume

  connectToRabbit()
  .then((conn)=>{
    return conn.createChannel();
  })
  .then((ch)=>{

    // working but goes directly to a queue
    // ch.assertQueue(q, {durable: false});
    // // Note: on Node 6 Buffer.from(msg) should be used
    // return ch.sendToQueue(q, new Buffer("bla bla bla emile say bla bla bla"));

    // using an exchange

    ch.assertExchange(ex, 'direct', {durable: false});
    ch.publish(ex, q, new Buffer(msg));
    console.log(" [x] Trigger Result Export %s: '%s'", q, msg);

  })
  .catch((err)=>{
    console.log("rabbit-sender error: ", err);
  });
}
app.get('/trigger_pika', (req, res) => {
  triggerResultExport();
  res.send("trigger pika.");
})


// Routes

app.get('/', (req, res) => {
  console.log("testing 1 2 3");
  res.send("Hello kubernetes world.");
})

app.get('/print/:message', (req, res) => {
  var message = req.params.message;
  console.log("message: ", message);
  res.send(message);
})

app.get('/write_json_to_volume', (req, res) => {
  
  var content_json = {
    "test": "jsonfile"
  }
  var content = JSON.stringify(content_json);

  fs.writeFile(volumePath + "/test_file.json", content, 'utf8', function (err) {
    if (err) {
        return console.log("file write error ", err);
    }
    console.log("The file was saved!");
  });

  res.send("written to FS");
})

app.get('/read_file', (req, res) => {
  var filename = req.query.filename;
  var pathName = volumePath + filename;
  fs.readFile(pathName, 'utf8', function (err,data) {
    if (err) {
      return console.log(err);
    }
    console.log(data);
    res.send(data);
  });
})

// RPC client code
app.get('/flowscope/rpc', (req, res) => {

    var ex = 'inputchanges';
    var send_key = 'FlowScopeConsumer';
    var reply_key = 'FlowScopeProducer';
    var message = '{ "jsonrpc": "2.0", "method": "useinputfile", "params": { "InputFile" : "ExampleWell1.json"} }';
    var corr = generateUuid();
    console.log('--> generated uuid ', corr);

    var ch = undefined;// keep a global scoped variable to refer to channel in subsequent requests
    var connection = undefined;

    connectToRabbit()
    .then((conn)=>{
      connection = conn;
      if (conn){
        console.log("connected to rabbit!");
        // sendRabbitMessage(conn, q, message);
      }else{
        console.log("There was no connection");
      }

      console.log('--> made rpc connection');

      return conn.createChannel();

    })
    .then((channel)=>{

      ch = channel;
        
      console.log('--> created rpc channel');

      ch.assertExchange(ex, 'direct', {durable: true});

      console.log('--> exchange asserted');

      return ch.assertQueue('', {exclusive: true});

    }).then((q) => {
      console.log('--> queue asserted callback');

      ch.bindQueue(q.queue, ex, reply_key);

      console.log('--> bindQueue called with reply_key');

      ch.consume(q.queue, function(msg) {
        console.log('--> channel consume callback ', msg.content.toString());
        if (msg.properties.correlationId == corr) {
          console.log(' [.] Got %s', msg.content.toString());
          
          setTimeout(function() { 
            connection.close(); 
            triggerResultExport();// trigger export after closing connection... just in case
          }, 500);
        }
      }, {noAck: true});

      // ch.sendToQueue('rpc_queue',
      // new Buffer(num.toString()),
      // { correlationId: corr, replyTo: q.queue });

      // publish to exchange instead of directly to queue
      ch.publish(ex, send_key, new Buffer(message), { correlationId: corr, replyTo: q.queue });
    });
  
  function generateUuid() {
    return Math.random().toString() +
           Math.random().toString() +
           Math.random().toString();
  }

  res.send('trying to make rpc connection');

});

// Send message to python listener
app.get('/flowscope/h5py', (req, res) => {

  var ex = 'result_trigger';
  var q = 'result_file_path';
  var msg = '/usr/src/app/FluidExampleWell1.h5';// this should be the path according to the volume

  connectToRabbit()
  .then((conn)=>{
    return conn.createChannel();
  })
  .then((ch)=>{

    // working but goes directly to a queue
    // ch.assertQueue(q, {durable: false});
    // // Note: on Node 6 Buffer.from(msg) should be used
    // return ch.sendToQueue(q, new Buffer("bla bla bla emile say bla bla bla"));

    // using an exchange

    ch.assertExchange(ex, 'direct', {durable: false});
    ch.publish(ex, q, new Buffer(msg));
    console.log(" [x] Sent %s: '%s'", q, msg);

  })
  .catch((err)=>{
    console.log("rabbit-sender error: ", err);
  });
  
    //   var ex = 'result_ready';
    //   var send_key = 'send_results_ready';
    //   var reply_key = 'receive_results_Ready';
    //   var message = 'results ready yo';
    //   var corr = generateUuid();
    //   console.log('--> generated uuid ', corr);
  
    //   var ch = undefined;// keep a global scoped variable to refer to channel in subsequent requests
    //   var connection = undefined;
  
    //   connectToRabbit()
    //   .then((conn)=>{
    //     connection = conn;
    //     if (conn){
    //       console.log("connected to rabbit!");
    //       // sendRabbitMessage(conn, q, message);
    //     }else{
    //       console.log("There was no connection");
    //     }
  
    //     console.log('--> made potential connection');
  
    //     return conn.createChannel();
  
    //   })
    //   .then((channel)=>{
  
    //     ch = channel;
          
    //     console.log('--> created python channel');
  
    //     ch.assertExchange(ex, 'direct', {durable: true});
  
    //     console.log('--> exchange asserted');
  
    //     return ch.assertQueue('yello');
  
    //   }).then((q) => {
    //     console.log('--> queue asserted callback --> python queue', q.queue);
  
    //     ch.bindQueue(q.queue, ex, reply_key);
  
    //     console.log('--> bindQueue called with reply_key');

    //     // publish to exchange instead of directly to queue
    //     ch.publish(ex, send_key, new Buffer(message), { correlationId: corr, replyTo: q.queue });
    //   });
    
    // function generateUuid() {
    //   return Math.random().toString() +
    //          Math.random().toString() +
    //          Math.random().toString();
    // }
  
    res.send('trying to make python connection');
  
  });


// Trigger simulator
app.get('/go_scope', (req, res)=>{
  connectAndSendRabbitMessage(filename, "ADDED_FILE_INPUT");
  res.send("triggered simulation")
});

// Form to upload a file
app.get('/file_upload', (req, res)=>{
  res.sendFile(path.join(__dirname + '/templates/file_upload.html'));
});

const download = (url, tempFilepath, filepath, callback) => {
  var tempFile = fs.createWriteStream(tempFilepath);
  tempFile.on('open', function(fd) {
    console.log("opened tempFile...");
    console.log("url to open: ", url);
      https.request(url, function(res) {
          console.log("requested url...", res);
          res.on('data', function(chunk) {
              console.log("write chunk...");
              tempFile.write(chunk);
          }).on('end', function() {
              console.log("end writing...");
              tempFile.end();
              fs.renameSync(tempFile.path, filepath);
              return callback(filepath);
          });
      }, function(err) {
        console.log("error with http: ", err);
      });
  });
}
app.post('/upload_file_url', (req, res)=>{

  var localVolumePath = path.join(__dirname, volumePath);

  console.log("req", req.body);

  // var filename = req.query.filename;// GET
  var filename = req.body.filename;// POST

  // ------------------------------
  //   READ THIS !!!!!!
  // ------------------------------
  // check that the pathname is correct for a Kubernetes Volume vs local filesystem... seems to be different K8s doesnt like __dirname...

  // TODO fix this when deployed to Kubernetes

  var pathName = volumePath + '/' + filename;
  // var pathName = localVolumePath + '/' + filename;
  // var url = req.query.downloadUrl;// GET
  var url = req.body.downloadUrl;// POST
  
  // a more direct approach
  var file = fs.createWriteStream(pathName);
  console.log("url: ", url);

  // url = "https://firebasestorage.googleapis.com/v0/b/turb-flux-ae-s.appspot.com/o/files%2FSg4O5gNq8WTsN3z6Lka8MeCAI9c2%2Fwell1%2FFluidwell1.h5?alt=media&token=fd942c13-306b-4044-8478-52c58b3e65f7";

  axios.request({
    responseType: 'arraybuffer',
    url: url,
    method: 'get'
  }).then((result) => {
    fs.writeFileSync(pathName, result.data);
  })
  .catch(err=>{
    console.log('axios file upload error -> ', err);
  });

  res.send('busy downloading / saving')

  // this works with JSON.stringify and json files... seems to not work with h5 files
  // axios.get(url)
  // .then(function (response) {
  //   console.log("get file response -->");
  //   console.log(response.data);
  //   file.write(response.data);
  //   file.end();
  // })
  // .catch(function (error) {
  //   console.log("h5 server error -->");
  //   console.log(error);
  // });


  // var request = https.get(url, (response) => {
  //   // response.pipe(file);
  //   // file.end();
  //   // console.log("-- response? --> ", response);

  //   console.log("-----------------------------------------");

  //   response.setEncoding('utf8');
  //   response.on('data', (body) => {
  //       console.log(body);
  //   });

  //   response.on('error', (err) => {
  //     console.error('response.on error ' + err.message);
  //   });

  //   // response.on('data', function(chunk) {
  //   //   console.log("string chunk: ", chunk.toString('utf8'));
  //   //   var textChunk = chunk.toString('utf8');
  //   //   // process utf8 text chunk
  //   // });
    
  //   file.write(response);
  //   file.end();

  // });


  // using the download function above
  // const acknowledged = (filepath) => {
  //   console.log("acknowledged... ", filepath);
  // }

  // // var file = fs.createWriteStream("file.jpg");
  // // var request = http.get("http://i3.ytimg.com/vi/J---aiyznGQ/mqdefault.jpg", function(response) {
  // //   response.pipe(file);
  // // });
  // download(url, pathName, pathName, acknowledged);
})

// File upload handler
app.post('/upload_file', (req, res)=>{
  console.log("HANDLE FILE UPLOAD");

  var filename = null;

  // create an incoming form object
  var form = new formidable.IncomingForm();

  // store all uploads in the /uploads directory
  form.uploadDir = volumePath;
  console.log(`form.uploadDir ${form.uploadDir}`);

  // every time a file has been uploaded successfully,
  // rename it to it's orignal name
  form.on('file', function(field, file) {
    filename = file.name;
    fs.rename(file.path, path.join(form.uploadDir, file.name));
    console.log(`rename files`);
  });

  // log any errors that occur
  form.on('error', function(err) {
    console.log('An error has occured: \n' + err);
  });

  // once all the files have been uploaded, send a response to the client
  form.on('end', function() {
    console.log("Done uploading...");
    res.end('success');

    // tell rabbit that the file has been uploaded
    // connectAndSendRabbitMessage(filename, "ADDED_FILE_INPUT");

  });

  // parse the incoming request containing the form data
  form.parse(req);

});





// Testing RabbitMQ + Flowscope
app.get('/flowscope/rabbit/1', (req, res) => {

  //"ExampleWell1.json"
  var inputFilename = req.query.input_filename;

  console.log("lets try to connect to the flow scope...", inputFilename);
  // var rabbitMessage = `{ "jsonrpc": "2.0", "method": "useinputfile", "params": { "InputFile" : ${inputFilename} }`;
  console.log("rabbit message: ", rabbitMessage);
  console.log("--------------------------------------");
  var rabbitMessage = JSON.stringify({ "jsonrpc": "2.0", "method": "useinputfile", "params": { "InputFile" : "ExampleWell1.json"} });

  try{
    connectAndSendRabbitMessage(rabbitMessage, 'adminqueue');
    res.send('sent');
  }catch(err){
    console.log("failed to connect to ampq", err);
    res.send(`failed to send rabbit message: ${rabbitMessage}`);
    res.send('not sent - err');
  }

});
// Testing RabbitMQ + Flowscope
app.get('/flowscope/rabbit/2', (req, res) => {
  
    //"ExampleWell1.json"
    var inputFilename = req.query.input_filename;
  
    console.log("lets try to connect to the flow scope...", inputFilename);
    // var rabbitMessage = `{ "jsonrpc": "2.0", "method": "useinputfile", "params": { "InputFile" : ${inputFilename} }`;
    console.log("rabbit message: ", rabbitMessage);
    console.log("--------------------------------------");
    var rabbitMessage = JSON.stringify({ "jsonrpc": "2.0", "method": "useinputfile", "params": { "InputFile" : "/ExampleWell1.json"} });
  
    try{
      connectAndSendRabbitMessage(rabbitMessage, 'adminqueue');
      res.send('sent');
    }catch(err){
      console.log("failed to connect to ampq", err);
      res.send(`failed to send rabbit message: ${rabbitMessage}`);
      res.send('not sent - err');
    }
  
  });







// Testing RabbitMQ
app.get('/api/v1/rabbit/:message', (req, res) => {
  var rabbitMessage = req.params.message;

  console.log("RabbitMQ message: ", rabbitMessage);
  console.log(`Rabbit host: --> amqp://${rabbitHost}`);

  try{

    amqp.connect(`amqp://${rabbitHost}`, function(err, conn) {
      console.log("Rabbit result? conn:", conn);  
      console.log("Rabbit result? err:", err);

      if (conn){
        console.log("connected to rabbitMQ ");
        conn.createChannel(function(err, ch) {
          var q = 'hello';

          ch.assertQueue(q, {durable: false});
          // Note: on Node 6 Buffer.from(msg) should be used
          ch.sendToQueue(q, new Buffer(rabbitMessage));
          console.log(" [x] Sent %s", rabbitMessage);
        });
        setTimeout(function() {
          conn.close();
          // process.exit(0)
        },
        500);
        res.send(`rabbit message sent: ${rabbitMessage}`);
      }else{
        throw "couldn't connect to RabbitMQ conn is falsy";
        res.send(`rabbit NOT message sent: ${rabbitMessage}`);
      }

    });

  }catch(err){
    console.log("failed to connect to ampq", err);
    res.send(`failed to send rabbit message: ${rabbitMessage}`);
  }

});

// var maxConnectionAttempts = 100;
// function ConnectToRabbit(){
//   try{
//     maxConnectionAttempts =- 1;
//     // listening for rabbitmq messages??
//     amqp.connect(`amqp://${rabbitHost}`, function(err, conn) {

//       console.log("Rabbit result? conn:", conn);  
//       console.log("Rabbit result? err:", err);
      
//       conn.createChannel(function(err, ch) {
//         var q = 'hello';
//         ch.assertQueue(q, {durable: false});
//         console.log(`... [*] Waiting for messages in ${q}. To exit press CTRL+C `);
//         ch.consume(q, function(msg) {
//           console.log(" [x] Received %s", msg.content.toString());
          
//           // fs.writeFile('test-file.txt', msg.content.toString(), function (err) {
//           //   if (err) return console.log(err);
//           //   console.log('wrote test-file.txt');
//           // });

//         }, {noAck: true});
//       });
//     });
//   }catch(err){
//     console.log("Couldn't connect to ampq host: ", err);

//     // wait 1 second until trying to connect again
//     if (maxConnectionAttempts > 0){
//       setTimeout(ConnectToRabbit(), 1000);
//     }
//   }
// }
// // connect to start listening
// ConnectToRabbit();




app.get('/h5serv', (req, res) => {
  axios.get("http://localhost:5000")
  .then(function (response) {
    console.log("h5 server response -->");
    console.log(response);
  })
  .catch(function (error) {
    console.log("h5 server error -->");
    console.log(error);
  });
  res.send("trying to test h5serv... vanilla")
})

app.get('/h5serv/headers', (req, res) => {
  axios({
    method: 'get',
    url: 'http://localhost:5000',
    headers: {'Host': `localhost:5000`}
  }).then((response)=>{
    console.log(JSON.stringify(response))
  }).catch(error => {
    console.log("--> error")
    console.log(JSON.stringify(error));
  });
})

app.get('/h5serv/qp', (req, res) => {
  var filename = req.query.filename;
  axios.get(`http://localhost:5000?host=${filename}`)
  .then(function (response) {
    console.log("h5 server response -->");
    console.log(JSON.stringify(response));
  })
  .catch(function (error) {
    console.log("h5 server error -->");
    console.log(error);
  });
  res.send("trying to test h5serv qp")
})

app.get('/h5serv/headers/a', (req, res) => {
  var filename = req.query.filename;
  axios({
    method: 'get',
    url: 'http://localhost:5000',
    headers: {'Host': `${filename}.localhost:5000`}
  }).then((response)=>{
    console.log(JSON.stringify(response))
  }).catch(error => {
    console.log("--> error")
    console.log(JSON.stringify(error));
  });

  res.send("testing h5serv with host header & domain");

});

app.get('/h5serv/headers/b', (req, res) => {
  var filename = req.query.filename;
  axios({
    method: 'get',
    url: 'http://localhost:5000',
    headers: {'Host': `${filename}`}
  }).then((response)=>{
    console.log(JSON.stringify(response))
  }).catch(error => {
    console.log("--> error")
    console.log(JSON.stringify(error));
  });

  res.send("testing h5serv with host header & domain");

});

app.get('/h5serv/headers/qp', (req, res) => {
  var filename = req.query.filename;
  axios({
    method: 'get',
    url: `http://localhost:5000?host=${filename}`,
    headers: {'Host': `${filename}.localhost:5000`}
  }).then((response)=>{
    console.log(JSON.stringify(response))
  }).catch(error => {
    console.log("--> error")
    console.log(JSON.stringify(error));
  });

  res.send("trying to test h5serv with host header & qp");

});


app.get('/h5serv/datasets/qp', (req, res) => {
  var filename = req.query.filename;
  axios.get(`http://localhost:5000/datasets?host=${filename}`)
  .then(function (response) {
    console.log("h5 server response -->");
    console.log(JSON.stringify(response));
  })
  .catch(function (error) {
    console.log("h5 server error -->");
    console.log(JSON.stringify(error));
  });
  res.send("trying to test h5serv dataset with qp");
})

app.get('/h5serv/datasets/header', (req, res) => {
  var filename = req.query.filename;
  axios({
    method: 'get',
    url: `http://localhost:5000/datasets?host=${filename}`,
    headers: {'Host': `${filename}.localhost:5000`}
  }).then((response)=>{
    console.log(JSON.stringify(response))
  }).catch(error => {
    console.log("--> error")
    console.log(JSON.stringify(error));
  });
  res.send("trying to test h5serv dataset with qp");
})

app.get('/h5serv/datasets/header', (req, res) => {
  var filename = req.query.filename;
  axios({
    method: 'get',
    url: `http://${filename}.localhost:5000/datasets`,
    headers: {'Host': `${filename}.localhost:5000`}
  }).then((response)=>{
    console.log(JSON.stringify(response))
  }).catch(error => {
    console.log("--> error")
    console.log(JSON.stringify(error));
  });
  res.send("trying to test h5serv dataset with domain");
})


app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);
