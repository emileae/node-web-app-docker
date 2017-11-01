const express = require('express');
const amqp = require('amqplib/callback_api');
const app = express();

const PORT = 3000;
const HOST = '0.0.0.0';

var handleError = (err) => {
  console.log("ERROR: ", err);
}

//docker run -p 49160:8080 -d emiru84/node-web-app
// the 172.17.0.2 --> is found when doing a docker inspect on the rabbitmq container
// seems to work since it starts listening
// trying to find how to trigger the running node... doesnt seem to work on locahost

const rabbitHost = "172.18.0.2";//"localhost";// rabbitmq'd docker host, I dont think this has anything to do with the container ip

// Enable CORS
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get('/', (req, res) => {
  console.log("testing 1 2 3");
  res.send("Helol wordl");
})

app.get('/print/:message', (req, res) => {
  var message = req.params.message;
  console.log("message: ", message);
  res.send(message);
})

// Testing RabbitMQ
app.get('/api/v1/rabbit/:message', (req, res) => {
  var rabbitMessage = req.params.message;

  console.log("RabbitMQ message: ", rabbitMessage);
  console.log(`Rabbit host: --> amqp://${rabbitHost}`);

  amqp.connect(`amqp://${rabbitHost}`, function(err, conn) {
    console.log("Rabbit result? ", err);

    console.log("connected to rabbitMQ ");
    conn.createChannel(function(err, ch) {
      var q = 'hello';
      // var msg = 'Yoyo World!';

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

  });

  res.send(`rabbit message sent: ${rabbitMessage}`);

});

// listening for rabbitmq messages??
amqp.connect(`amqp://${rabbitHost}`, function(err, conn) {
  console.log("ERR: ", err);
  conn.createChannel(function(err, ch) {
    var q = 'hello';
    ch.assertQueue(q, {durable: false});
    console.log(`... [*] Waiting for messages in ${q}. To exit press CTRL+C `);
    ch.consume(q, function(msg) {
      console.log(" [x] Received %s", msg.content.toString());
    }, {noAck: true});
  });
});

// app.listen(process.env.PORT || 3000);
app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);
