const parseArgs = require("minimist");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const moment = require("moment");
const dotProp = require("dot-prop");
const _ = require("underscore");
const asciichart = require("asciichart");
const ansiEscapes = require("ansi-escapes");

const GEO_API_BASE_URL = "https://api.geotogether.com";

const READINGS = [];

const argOpts = {
  string: ["username", "password", "system", "output"],
  alias: {
    username: "u",
    password: "p",
    system: "s",
    refresh: "r",
    width: "w",
    height: "h",
    output: "o",
  },
  default: {
    refresh: 30,
    width: process.stdout.columns || 100,
    height: process.stdout.rows || 10,
    output: "chart",
  },
};

function getLiveData(accessToken, systemId) {
  return new Promise((resolve, reject) => {
    axios
      .get(`${GEO_API_BASE_URL}/api/userapi/system/live-data/${systemId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
      .then((response) => {
        return resolve(response.data);
      })
      .catch(reject);
  });
}

function displayLiveData(data, outputType, chartHeight, chartWidth) {
  if (data.power && data.power.length > 0) {
    const reading = {
      timestamp: data.utc,
      import: _.findWhere(data.power, { type: "IMPORT" }).watts,
    };
    READINGS.push(reading);

    if (outputType === "text") {
      // Textual
      console.log(`Live usage at ${moment.unix(data.utc).format("HH:mm")}:`);
      _.each(data.power, (item) => {
        console.log(`- ${item.type}: ${item.watts}W`);
      });
    } else if (outputType === "graph") {
      // Graphical
      const padding = "       ";
      const offset = 3;
      const adjustment = offset - 6;
      const plottable = _.map(
        _.last(READINGS, chartWidth - adjustment),
        (item) => {
          return item.import;
        }
      );

      while (plottable.length < chartWidth - adjustment) {
        plottable.unshift(0);
      }

      process.stdout.write(
        ansiEscapes.eraseLines(chartHeight + 1) +
          asciichart.plot(plottable, {
            height: chartHeight,
            offset, // axis offset from the left (min 2)
            padding,
            // the label format function applies default padding
            format: function (x, i) {
              return (padding + x.toFixed(2)).slice(-padding.length);
            },
          })
      );
    }
  } else {
    // console.log("Data unavailable :(");
  }
}

function getAccessToken(username, password) {
  return new Promise((resolve, reject) => {
    axios
      .post(`${GEO_API_BASE_URL}/usersservice/v2/login`, {
        identity: username,
        password: password,
      })
      .then((response) => {
        return resolve(response.data.accessToken);
      })
      .catch((error) => {
        return reject(error);
      });
  });
}

function getValidAccessToken(accessToken, username, password) {
  return new Promise((resolve, reject) => {
    if (accessToken) {
      const decoded = jwt.decode(accessToken);
      if (decoded.exp > moment().add(30, "seconds").unix()) {
        // all good
        return resolve(accessToken);
      } else {
        // no, we need a new token
        getAccessToken(username, password)
          .then((result) => resolve(result))
          .catch(reject);
      }
    } else {
      // get a new token
      getAccessToken(username, password)
        .then((result) => resolve(result))
        .catch(reject);
    }
  });
}

function getSystemId(accessToken, systemId) {
  return new Promise((resolve, reject) => {
    if (systemId) {
      return resolve(systemId);
    }

    axios
      .get(`${GEO_API_BASE_URL}/api/userapi/v2/user/detail-systems`, {
        params: {
          systemDetails: true,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
      .then((response) => {
        return resolve(response.data.systemDetails[0].systemId);
      })
      .catch((error) => {
        return reject(error);
      });
  });
}

function main() {
  let accessToken;
  let systemId;

  // parse command line args
  const argv = parseArgs(process.argv.slice(2), argOpts);

  if (!argv.username || !argv.password) {
    console.error("Username and password must be provided");
    process.exit(1);
  }

  if (argv.refresh) {
    argv.refresh = parseInt(argv.refresh, 10);
    if (argv.refresh < 1) {
      console.error("Minimum refresh interval is 1 second");
      process.exit(1);
    }

    argv.refresh = argv.refresh * 1000; // seconds to ms
  }

  if (argv.output !== "chart" && argv.output !== "text") {
    console.error("Output type must be chart or text");
    process.exit(1);
  }

  argv.height = parseInt(argv.height, 10);
  argv.width = parseInt(argv.width, 10);

  setIntervalImmediately(() => {
    // console.log("Checking usage...");
    getValidAccessToken(accessToken, argv.username, argv.password)
      .then((result) => {
        accessToken = result;
        return getSystemId(accessToken, systemId);
      })
      .then((result) => {
        systemId = result;
        return getLiveData(accessToken, systemId);
      })
      .then((result) => {
        displayLiveData(result, argv.output, argv.height, argv.width);
      })
      .catch((err) => {
        console.error("err: ", err.message);
      });
  }, argv.refresh);
}

function setIntervalImmediately(func, interval) {
  func();
  return setInterval(func, interval);
}

main();
