// node built-in
const fs = require('fs');
var path = require('path');

// express
const express = require('express');

// rabbitmq client
// const amqp = require('amqplib/callback_api');
const amqp = require('amqplib');

// npm libs
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


// Trigger simulator
app.get('/go_scope', (req, res)=>{
  connectAndSendRabbitMessage(filename, "ADDED_FILE_INPUT");
  res.send("triggered simulation")
});

// Form to upload a file
app.get('/file_upload', (req, res)=>{
  res.sendFile(path.join(__dirname + '/templates/file_upload.html'));
});

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










// app.listen(process.env.PORT || 3000);
app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);
