const Request = require('request');

const slack = require('../../../lib/slack_client').client;
const channelID = require('../../../lib/slack_client').channelID;

const User = require("../../users/model");
const Subscription = require("../model");

const helpers = require("../helpers");
const messenger = require("../messenger");

const slackOpts = {
  as_user: true,
  username: "captainhook"
};

const login = function(info) {
  var opts = {
    uri:'https://registry.npmjs.com/-/whoami',
    auth: { bearer: info.token }
  };
  return Request.get(opts, function(err, res, body){
    if(res.statusCode === 401) {
      slack.chat.postMessage(channelID, body, slackOpts);
    }

    return User.where('npm-token-hashed', info.token)
      .fetch({
        require: false
      })
      .then(function(user){
        if( user == null ){
          throw new Error("User not found");
        }
        return user.set({'npm-token-hashed': info.token}).save();
      })
      .catch(function(){
        var userOpts = helpers.buildUser(opts, body);
        return User.forge(userOpts).save();
      })
      .finally(function(){
        slack.chat.postMessage(channelID, messenger.loggedIn, slackOpts);
      });
  });
};

const logout = function(info) {
  // this is waiting on Slack App Integration
};

var subscribe = function(info) { 
  var hook_opts = helpers.buildHookRequestOpts(info);
  Request.post(hook_opts, function(err, res, body) {
    if (err) {
      slack.chat.postMessage(channelID, err.toString(), slackOpts);
    } else {
      console.log('just created hook with id=' + body.id);
      var subscription = helpers.buildSubscription(hook_opts, body);
      Subscription.forge(subscription).save()
      .then(function(record) {
        if (!record) {
          slack.chat.postMessage(channelID, messenger.bookshelf, slackOpts);
        } else {
          var message =  messenger.buildSuccessMessage(record);
          slack.chat.postMessage(channelID, message, slackOpts);
        }
      })
      .catch();
    }
  });
};

var unsubscribe = function(info) {
  Subscription.where({ type: info.type, name: info.name }).fetch()
  .then(function(record) {
    var hook_opts = {
      uri: "https://registry.npmjs.org/-/npm/v1/hooks/hook/" + record.attributes.hook_id,
      auth: { bearer: process.env.NPM_AUTH_TOKEN }
    };
    Request.delete(hook_opts, function(err, res, body) {
      if (err) {
        slack.chat.postMessage(channelID, body, slackOpts);
      } else {
        record.destroy()
        .then(function(record) {
          slack.chat.postMessage(channelID, "Subscription successfully deleted!", slackOpts);
        })
        .catch();
      }
    });
  })
  .catch();
};

var list = function(info) {
  Subscription.where({ 'user_id': 1}).fetchAll()
  .then(function(collection) {
    console.log(collection);
    var message = "Your Hooks:\n" + 
                  "*id*\t\t*type*\t\t*name*\t\t*event*\n";
    var subscriptions = collection.models;
    for (var i = 0; i < subscriptions.length; i++) {
      var subscription = subscriptions[i].attributes;
      console.log(subscription);
      message += subscription.id + "\t\t" +
                 subscription.type + "\t\t" +
                 subscription.name + "\t\t" +
                 subscription.event + "\n";
    }
    slack.chat.postMessage(channelID, message, slackOpts);
  })
  .catch();
};

var help = function() {
  var message = "arrrr! i'm captain hook\n" +
         "*usage:* \n" +
         "`/captain-hook <command> <type> <name> <event>`\n" +
         "\n" +
         "\t\t*command*: `subscribe` (create a new webhook), `help`, `list`\n" +
         "\t\t*type*: `package` or `scope`\n" +
         "\t\t*name*: the name of the package or scope, e.g. `lodash`\n" +
         "\t\t*event*: this doesn't actually work yet :grimacing: :sweat_smile:\n" +
         "\n" +
         "\n" +
         "/captain-hook login <token>";

  slack.chat.postMessage(channelID, message, slackOpts);
};

// receive outgoing integration from slack `/captain-hook`
module.exports = function(request, response, next) {
  var info = helpers.parseRequestBody(request);
  switch(info.command) {
    case "login":
      login(info);
      break;
    case "subscribe":
      subscribe(info);
      break;
    case "unsubscribe":
      unsubscribe(info);
      break;
    case "list":
      list(info);
      break;
    case "help":
      help();
      break;
    default:
      help();
      break;
  }
  next();
};
