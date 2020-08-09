let express =require('express');
let mongoose = require('mongoose');
let Schema = mongoose.Schema;
let bodyParser = require('body-parser');
let cookieParser = require('cookie-parser');
let cors = require('cors');
let server = require('../main');
let request = require('request');
let services = require('../../Services/services');
let app = express();
let responseSchema = new Schema({
  ipAddress: String,
  requestID: Number,
  service: String,
  result: String
});
let responses = mongoose.model('response', responseSchema);
let DB_URL = process.env.DB || "mongodb://test:test1234@ds163905.mlab.com:63905/service-provider";

app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors());
mongoose.connect(DB_URL, () => {
  console.log('Connected to Response DB store');
});

function marshall(service) {
  let data = {};
  let allParams = [];

  data['serviceName'] = service.name;
  for(let count in service.parameters) {
    allParams.push({
      position: parseInt(count, 10) + 1,
      type: service.parameters[count]
    })
  }
  data['parameters'] = allParams;
  data['returnType'] = service.returnType;
  data['server'] = 'http://localhost:5000';

  return data;
}

function unmarshall(data) {
  let procedure = {
    name: '',
    arguments: []
  };
  procedure.name = data.serviceName;
  data.parameters.forEach((parameter) => {
    procedure.arguments[parameter.parameterPosition - 1] = parameter.parameterValue;
  });

  return procedure;
}

function registerRPC(services) {
  services.forEach(service => {
    let marshalled_service = marshall(service);
    console.log(marshalled_service);
    let options = {
      method: 'post',
      body: marshalled_service,
      json: true,
      url: 'http://localhost:8000/map'
    };

    request(options, function (err, resp) {
      if (err) {
        console.log(err);
      } else {
        let data = resp.body;
        console.log('Service registered');
      }
    })
  });
}

function computeResult(data) {
  let { name, arguments } = unmarshall(data);
  let result = server[name].apply(this, arguments);

  return result;
}

function completeRequest() {
  let options = {
    url: 'http://localhost:8000/completed',
    headers: {
      'data': JSON.stringify({serverAddress: 'http://localhost:5000'})
    }
  };

  request.put(options, function (err, res) {
    console.log('Completed Request');
    if (err) {
      console.log(err);
      // est();
    }
  });
}

app.get('/active', function(req, res) {
  console.log('Active');
  res.send(JSON.stringify({
    result: true
  }));
});

app.post('/', function(req,res) {
  let data = req.body;
  let ip = data.clientIp;
  let service = data.serviceName;

  responses.findOne({ipAddress: ip, service: service}, function(err, response) {
    if(!err && response) {
      if(response.requestID < data.requestID) {
        let result = computeResult(data);
        let newResponse = response;

        newResponse.result = result;
        newResponse.requestID = data.requestID;

        responses.update({ipAddress: ip, service: service}, newResponse, (error, resp) => {
          if(!error && resp) {
            console.log('Updated Result');
          }
        });
        res.send(JSON.stringify(result));
      } else {
        res.send(JSON.stringify(response.result));
      }
    } else {
        let result = computeResult(data);
        let response = {
          ipAddress: ip,
          requestID: data.requestID,
          service: data.serviceName,
          result: result
        };

        responses.update({ipAddress: ip, service: data.serviceName}, response, {upsert: true},(err, resp) => {
            console.log('Added new IP or service to response DB');
        });
        res.send(JSON.stringify(result));
    }
    completeRequest();
  });

});

app.listen(5000, function(err) {
  if(!err) {
    registerRPC(services.allServices);
    console.log('Server started');
  }
});
