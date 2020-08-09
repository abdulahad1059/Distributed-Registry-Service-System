let express = require('express');
let bodyParser = require('body-parser');
let cookieParser = require('cookie-parser');
let mongoose = require('mongoose');
let schema = mongoose.Schema;
let app = express();
let cors = require('cors');
let RateLimit = require('express-rate-limit');
let RedisStore = require('rate-limit-redis');
let redis = require('redis');
let request = require('request');
let parametersSchema = new schema({
  parameterPosition: Number,
  parameterType: String
}, { _id : false });
let serverSchema = new schema({
  ip: String,
  numberOfRequests: Number
});
let serviceSchema = new schema({
  serviceName: String,
  parameters: [parametersSchema],
  serverAddress: [String],
  returnType: String
});
let services = mongoose.model("service", serviceSchema);
let servers = mongoose.model("server", serverSchema);
const DB_URL = process.env.DB || "mongodb+srv://shivansh:shivansh@cluster0-jmsah.mongodb.net/test?retryWrites=true&w=majority";

app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors());
mongoose.connect(DB_URL, function(err, res) {
  if(!err) {
    console.log("Connected to Registry service database");
  }
});
mongoose.Promise = global.Promise;

const client = redis.createClient(process.env.REDIS_URL || 'redis://localhost:6379');
const expireInSeconds = 10;
const requestLimit = 10;
const rateLimiter = new RateLimit({
  store: new RedisStore({
    client: client,
    expiry: expireInSeconds
  }),
  windowMs: 1000 * expireInSeconds,
  max: requestLimit
});

async function getServer(response) {

  return new Promise(function(resolve, reject){
    let minimum = Number.MAX_SAFE_INTEGER;
    let result = null;
    let promiseArr = [];

    response.serverAddress.forEach(server => {
      let res = servers.findOne({ip: server}).exec();
      promiseArr.push(res);
    });

    Promise.all(promiseArr).then((resp) => {
      resp.forEach(res => {
        if(res.numberOfRequests <= minimum) {
          result = res.ip;
          minimum = res.numberOfRequests;
        }
      });
      response.serverAddress = result;
      resolve({service: response});
    });
  });
}

app.use(rateLimiter);
app.get('/', function(req, res) {
  res.send('Welcome to Registry Service');
});

app.get('/all-procedures', (req, res) => {
  services.find({}, {serviceName:1}, (err, response) => {
    let procedureNames = response.map(element => element.serviceName);

    res.send(procedureNames);
  })
});

app.put('/completed', (req, response) => {
  let data = JSON.parse(req.headers.data);
  let serverAddress = data.serverAddress;

  servers.findOne({ip: serverAddress}, (err, res) => {
    let activeRequests = res.numberOfRequests;

    activeRequests -= 1;
    res.numberOfRequests = activeRequests;
    servers.updateOne({ip: serverAddress}, res, (err, res) => {
      response.send(JSON.stringify({message: "Updated requests"}));
    });
  });
});

app.post('/map', function(req, res) {
  // let data = {
  //   serviceName: "add",
  //   parameters: [{
  //     position: 1,
  //     type: "int"
  //   }, {
  //       position: 2,
  //       type: "int"
  //     }],
  //   server: "http://localhost:7000",
  //   returnType: "int"
  // };
  let data = req.body;
  let serviceName = data.serviceName;
  let server = data.server;
  let parameters = data.parameters;
  let returnType = data.returnType;
  let allParams = [];

  for(let index in parameters) {
    const parameter = {
      parameterPosition: parameters[index]['position'],
      parameterType: parameters[index]['type']
    };

    allParams.push(parameter);
  }
  let service = {
    serviceName: serviceName,
    parameters: allParams,
    returnType: returnType
  };
  let serversList = [];
  let serverData = {
    ip: server,
    numberOfRequests: 0
  };

  services.findOne({'serviceName': serviceName, 'parameters': allParams}, {serverAddress:1}, (err, response) => {
    if(!err && response) {
      serversList = response.serverAddress;
    }
    let index = serversList.indexOf(server);

    if(index === -1) {
      serversList.push(server);
    }
    service.serverAddress = serversList;
    services.update({'serviceName': serviceName, 'parameters': allParams}, service, {upsert: true}, (err, response) => {
      if (!err) {
        res.send(response);
        servers.update({'ip': server}, serverData, {upsert: true}, (err, response) => {
          //console.log('Update made in servers collection');
        });
      }
    });
  });
});

app.get('/service-provider', function(req, res) {
  // let data = {
  //   serviceName: "addition",
  //   parameters: [{
  //     parameterPosition: 1,
  //     parameterType: "int"
  //   }, {
  //       parameterPosition: 2,
  //       parameterType: "int"
  //     }, {
  //       parameterPosition: 3,
  //       parameterType: "string"
  //     }]
  // };

  let requestedService = JSON.parse(req.headers.data);
  services.findOne(requestedService, function(err, resp) {
    let modifiedResp = JSON.parse(JSON.stringify(resp));
    getServer(modifiedResp).then((server) => {
      let service = server.service;
      //service.serverAddress = 'http://localhost:5000';
      //console.log(service.serverAddress);
      if (!err && service) {
        request.get(service.serverAddress + '/active', function (request, response) {
          if (response) {
            response = JSON.parse(response.body);
            //console.log(response);
            if (response.result == true) {
              console.log(service.serverAddress);
              servers.findOne({"ip": service.serverAddress}, function (error, serverEntry) {
                if(error) {
                  console.log(error);
                }

                let modifiedServerEntry = serverEntry;

                //console.log(modifiedServerEntry);
                modifiedServerEntry.numberOfRequests += 1;
                servers.updateOne({'ip': service.serverAddress}, modifiedServerEntry, function (err, updateResponse) {
                  res.status(200).send(service);
                })
              });
            }
          } else {
            services.update(resp, {$pull: {serverAddress: service.serverAddress}}, function (err, deleteResponse) {
              //console.log(deleteResponse);
            });
            res.status(503).send(JSON.stringify({message: "Please retry"}));
          }
        });
      } else {
        res.status(400).send({Message: 'Not found'});
      }
    });
  });
});

let listener = app.listen(8000, function(err) {
  if(!err) {
    console.log('Registry server started on PORT ' + listener.address().port);
  }
});
