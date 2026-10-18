import mqtt from 'mqtt';

const brokerUrl = "mqtts://broker.emqx.io:8883";

const topic = "testtopic/1";
const payload = "180";
const qos = 0;

const clientId = "emqx_nodejs_" + Math.random().toString(16).substring(2, 8);
const username = "emqx_test";
const password = "emqx_test";

const client = mqtt.connect(brokerUrl, {
  clientId,
  username,
  password,
});

client.subscribe(topic, { qos }, (error) => {
    if(error) {
        console.log(error);
        return
    } else {
        console.log("Subscribed");
    }
});

client.on("connect", () => {
  console.log("Connected");
  client.publish(topic, payload, { qos }, (error) => {
    if (error) {
      console.error(error);
    } else {
      console.log("Message sent");
    }
  });
});

client.on("message", (topic, payload) => {
  console.log("Received message: ", topic, payload.toString());
});

client.on("error", (err) => {
  console.error(err);
});
