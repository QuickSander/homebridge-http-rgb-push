// ISC License - Copyright 2018, Sander van Woensel
// TODO: colorsys usage?
//       enable coverage measurement.

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const PACKAGE_JSON = require('./package.json');
const MANUFACTURER = PACKAGE_JSON.author.name;
const SERIAL_NUMBER = '001';
const MODEL = PACKAGE_JSON.name;
const FIRMWARE_REVISION = PACKAGE_JSON.version;

const IDENTIFY_BLINK_DELAY_MS = 250; // [ms]
const DEFAULT_BRIGHTNESS_MAX = 100;

// -----------------------------------------------------------------------------
// Module variables
// -----------------------------------------------------------------------------
var Service, Characteristic;
var request = require('request');
var api;
var convert = require('color-convert');

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------


//! @module homebridge
//! @param {object} homebridge Export functions required to create a
//!    new instance of this plugin.
module.exports = function(homebridge){
    api = homebridge;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory(MODEL, 'HttpPushRgb', HttpPushRgb);
};

// -----------------------------------------------------------------------------
// Module functions
// -----------------------------------------------------------------------------

/**
 * Parse the config and instantiate the object.
 *
 * @constructor
 * @param {function} log Logging function.
 * @param {object} config The configuration object.
 */
function HttpPushRgb(log, config) {

    this.log = log;

    this.service                       = null;
    this.serviceCategory               = config.service;
    this.name                          = config.name                      || 'RGB Light';

    this.http_method                   = config.http_method               || 'GET';
    this.username                      = config.username                  || '';
    this.password                      = config.password                  || '';
    this.timeout                       = config.timeout                   || 10000;

    // Handle the basic on/off
    this.switch = { powerOn: {}, powerOff: {}, status: {} };
    if (typeof config.switch === 'object') {

        this.switch.status.bodyRegEx   = new RegExp("1");
        // Intelligently handle if config.switch.status is an object or string.
        if (typeof config.switch.status === 'object') {
            this.switch.status.url         = config.switch.status.url;

            // Verify type of body regular expression parameter.
            if (typeof config.switch.status.bodyRegEx === "string") {
               this.switch.status.bodyRegEx = new RegExp(config.switch.status.bodyRegEx);
            }
            else {
               this.log("Property 'switch.status.bodyRegEx' was provided in an unsupported type. Using default one!");
            }
        } else {
            this.switch.status.url         = config.switch.status;
        }

        // Intelligently handle if config.switch.powerOn is an object or string.
        if (typeof config.switch.powerOn === 'object') {
            this.switch.powerOn.set_url    = config.switch.powerOn.url;
            this.switch.powerOn.body       = config.switch.powerOn.body;
        } else {
            this.switch.powerOn.set_url    = config.switch.powerOn;
        }

        // Intelligently handle if config.switch.powerOff is an object or string.
        if (typeof config.switch.powerOff === 'object') {
            this.switch.powerOff.set_url   = config.switch.powerOff.url;
            this.switch.powerOff.body      = config.switch.powerOff.body;
        } else {
            this.switch.powerOff.set_url   = config.switch.powerOff;
        }

        // Register notification server.
        api.on('didFinishLaunching', function() {
           // Check if notificationRegistration is set and user specified notificationID.
           // if not 'notificationRegistration' is probably not installed on the system.
           if (global.notificationRegistration && typeof global.notificationRegistration === "function" &&
               config.switch.notificationID) {
               try {
                  global.notificationRegistration(config.switch.notificationID, this.handleNotification.bind(this), config.switch.notificationPassword);

               } catch (error) {
                   // notificationID is already taken.
               }
           }
        }.bind(this));

    }

    // Local caching of HSB color space for RGB callback
    this.cache = {};
    this.cacheUpdated = false;

    // Handle brightness
    if (typeof config.brightness === 'object') {
        this.brightness = {status: {}, set_url: {}};
        if (typeof config.brightness.status === 'object') {
            this.brightness.status.url = config.brightness.status.url;
            this.brightness.status.bodyRegEx = new RegExp(config.brightness.status.bodyRegEx);
        } else {
            this.brightness.status.url = config.brightness.status;
        }
        if (typeof config.brightness.url === 'object') {
            this.brightness.set_url.url = config.brightness.url.url || this.brightness.status.url;
            this.brightness.set_url.body = config.brightness.url.body || '';
        } else {
            this.brightness.set_url.url = config.brightness.url || this.brightness.status.url;
            this.brightness.set_url.body = '';
        }
        this.brightness.http_method    = config.brightness.http_method    || this.http_method;
        this.brightness.max = config.brightness.max || DEFAULT_BRIGHTNESS_MAX;
        this.cache.brightness = 0;
    } else {
        this.brightness = false;
        this.cache.brightness = 100;
    }

    // Color handling
    if (typeof config.color === 'object') {
        this.color = {"set_url": {}, "get_url": {}};
        if (typeof config.color.url === 'object') {
            this.color.set_url.url = config.color.url.url || this.color.status;
            this.color.set_url.body = config.color.url.body;
        } else {
            this.color.set_url.url = config.color.url || this.color.status;
            this.color.set_url.body = '';
        }

        if (typeof config.color.status === 'object') {
            this.color.get_url.url = config.color.status.url;
            this.color.get_url.bodyRegEx = config.color.status.bodyRegEx || '';
        } else {
            this.color.get_url.url = config.color.status;
            this.color.get_url.bodyRegEx = '';
        }

        this.color.http_method         = config.color.http_method         || this.http_method;
        this.color.brightness          = config.color.brightness;
        this.cache.hue = 0;
        this.cache.saturation = 0;
    } else {
        this.color = false;
    }

    this.has = { brightness: this.brightness || (typeof this.color === 'object' && this.color.brightness) };

}

/**
 * @augments HttpPushRgb
 */
HttpPushRgb.prototype = {

    // Required Functions

    /**
     * Blink device to allow user to identify its location.
     */
    identify: function(callback) {
        this.log('Identify requested!');

        this.getPowerState( (error, onState) => {

           this.setPowerState(!onState, (error, responseBody) => {
               // Ignore any possible error, just continue as if nothing happened.
               setTimeout(() => {
                  this.setPowerState(onState, callback);
               }, IDENTIFY_BLINK_DELAY_MS);
           });
        });
    },

    getServices: function() {
        var informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
            .setCharacteristic(Characteristic.SerialNumber, SERIAL_NUMBER)
            .setCharacteristic(Characteristic.Model, MODEL)
            .setCharacteristic(Characteristic.FirmwareRevision, FIRMWARE_REVISION);

        switch (this.serviceCategory) {
            case 'Fan':
                this.log('Creating Fan');
                this.service = new Service.Fan(this.name);

                if (this.switch.status) {
                    this.service
                        .getCharacteristic(Characteristic.On)
                        .on('get', this.getPowerState.bind(this))
                        .on('set', this.setPowerState.bind(this));
                } else {
                    this.service
                        .getCharacteristic(Characteristic.On)
                        .on('set', this.setPowerState.bind(this));
                }

                // Handle fan speed
                if (this.has.brightness) {
                    this.log('... adding fan speed');
                    this.service
                        .addCharacteristic(new Characteristic.RotationSpeed())
                        .on('get', this.getBrightness.bind(this))
                        .on('set', this.setBrightness.bind(this));
                }

                return [informationService, this.service];

            case 'Light':
                this.log('Creating Lightbulb');
                this.service = new Service.Lightbulb(this.name);

                if (this.switch.status) {
                    this.service
                        .getCharacteristic(Characteristic.On)
                        .on('get', this.getPowerState.bind(this))
                        .on('set', this.setPowerState.bind(this));
                } else {
                    this.service
                        .getCharacteristic(Characteristic.On)
                        .on('set', this.setPowerState.bind(this));
                }

                // Handle brightness
                if (this.has.brightness) {
                    this.log('... adding brightness');
                    this.service
                        .addCharacteristic(new Characteristic.Brightness())
                        .on('get', this.getBrightness.bind(this))
                        .on('set', this.setBrightness.bind(this));
                }

                // Handle color
                if (this.color) {
                    this.log('... adding color');
                    this.service
                        .addCharacteristic(new Characteristic.Hue())
                        .on('get', this.getHue.bind(this))
                        .on('set', this.setHue.bind(this));

                    this.service
                        .addCharacteristic(new Characteristic.Saturation())
                        .on('get', this.getSaturation.bind(this))
                        .on('set', this.setSaturation.bind(this));
                }

                return [informationService, this.service];

            case 'Switch':
                this.log('creating Switch');
                this.service = new Service.Switch(this.name);

                if (this.switch.status) {
                    this.service
                        .getCharacteristic(Characteristic.On)
                        .on('get', this.getPowerState.bind(this))
                        .on('set', this.setPowerState.bind(this));
                } else {
                    this.service
                        .getCharacteristic(Characteristic.On)
                        .on('set', this.setPowerState.bind(this));
                }
                return [informationService, this.service];

            default:
                return [informationService];

        } // end switch
    },

   //** Custom Functions **//

   /**
     * Called by homebridge-http-notification-server
     * whenever an accessory sends a status update.
     *
     * @param {function} jsonRequest The characteristic and characteristic value to update.
     */
   handleNotification: function (jsonRequest) {
        const service = jsonRequest.service;

        const characteristic = jsonRequest.characteristic;
        const value = jsonRequest.value;

        let characteristicType;
        switch (characteristic) {
            case "On":
                characteristicType = Characteristic.On;
                break;
            default:
                this.log("Encountered unknown characteristic when handling notification: " + jsonRequest.characteristic);
                return;
        }

        this.ignoreNextSetPowerState = true; // See method setPowerStatus().
        this.service.setCharacteristic(characteristicType, value); // This will also call setPowerStatus() indirectly.
    },

    /**
     * Gets power state of lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    getPowerState: function(callback) {
        if (!this.switch.status.url) {
            this.log.warn('Ignoring request, switch.status not defined.');
            callback(new Error('No switch.status url defined.'));
            return;
        }

        var url = this.switch.status.url;

        this._httpRequest(url, '', 'GET', function(error, response, responseBody) {
            if (!this._handleHttpErrorResponse('getPowerState()', error, response, responseBody, callback)) {
               var powerOn = this.switch.status.bodyRegEx.test(responseBody)
               this.log('power is currently %s', powerOn ? 'ON' : 'OFF');
               callback(null, powerOn);
            }
        }.bind(this));
    },

    /**
     * Sets the power state of the lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    setPowerState: function(state, callback) {
        var url;
        var body;

        if (!this.switch.powerOn.set_url || !this.switch.powerOff.set_url) {
            this.log.warn('Ignoring request, powerOn.url or powerOff.url is not defined.');
            callback(new Error("The 'switch' section in your configuration is incorrect."));
            return;
        }

        // Prevent an infinite loop when setCharacteristic() from
        // handleNotification() also indirectly calls setPowerState.
        if (this.ignoreNextSetPowerState) {
            this.ignoreNextSetPowerState = false;
            callback(undefined);
            return;
        }

        if (state) {
            url = this.switch.powerOn.set_url;
            body = this.switch.powerOn.body;
        } else {
            url = this.switch.powerOff.set_url;
            body = this.switch.powerOff.body;
        }

        this._httpRequest(url, body, this.http_method, function(error, response, responseBody) {
            if (!this._handleHttpErrorResponse('setPowerState()', error, response, responseBody, callback)) {
                this.log('setPowerState() successfully set to %s', state ? 'ON' : 'OFF');
                callback(undefined, responseBody);
            }
        }.bind(this));
    },

    /**
     * Gets brightness of lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    getBrightness: function(callback) {
        if (!this.has.brightness) {
            this.log.warn("Ignoring request; No 'brightness' defined.");
            callback(new Error("No 'brightness' defined in configuration"));
            return;
        }

        if (this.brightness) {
            this._httpRequest(this.brightness.status.url, '', 'GET', function(error, response, responseBody) {
                if (!this._handleHttpErrorResponse('getBrightness()', error, response, responseBody, callback)) {
                    if (typeof this.brightness.status.bodyRegEx === 'object') {
                        var level = responseBody.match(this.brightness.status.bodyRegEx)[1];
                    } else {
                        var level = parseInt(responseBody);
                    }

                    level = parseInt(100 / this.brightness.max * level);

                    this.log('brightness is currently at %s %', level);
                    callback(null, level);
                }
            }.bind(this));
        } else {
            callback(null, this.cache.brightness);
        }
    },

    /**
     * Sets the brightness of the lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    setBrightness: function(level, callback) {
        if (!this.has.brightness) {
            this.log.warn("Ignoring request; No 'brightness' defined.");
            callback(new Error("No 'brightness' defined in configuration"));
            return;
        }
        this.cache.brightness = level;

        // If achromatic or color.brightness is false, update brightness, otherwise, update HSL as RGB
        if (!this.color || !this.color.brightness) {
            var calculatedLevel = Math.ceil(this.brightness.max / 100 * level);

            var url = this.brightness.set_url.url.replace('%s', calculatedLevel);
            var body = this.brightness.set_url.body.replace('%s', calculatedLevel);

            this._httpRequest(url, body, this.brightness.http_method, function(error, response, responseBody) {
                if (!this._handleHttpErrorResponse('setBrightness()', error, response, responseBody, callback)) {
                    this.log('setBrightness() successfully set to %s %', level);
                    callback();
                }
            }.bind(this));
        } else {
            this._setRGB(callback);
        }
    },

    /**
     * Gets the hue of lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    getHue: function(callback) {
        if (this.color && typeof this.color.get_url.url !== 'string') {
            this.log.warn("Ignoring getHue request; problem with 'color' variables.");
            callback(new Error("There was a problem parsing the 'color.status' section of your configuration."));
            return;
        }
        var url = this.color.get_url.url;

        this._httpRequest(url, '', 'GET', function(error, response, responseBody) {
            if (!this._handleHttpErrorResponse('getHue()', error, response, responseBody, callback)) {
                var rgb = responseBody;
                var levels = this._rgbToHsl(
                    parseInt(rgb.substr(0,2),16),
                    parseInt(rgb.substr(2,2),16),
                    parseInt(rgb.substr(4,2),16)
                );

                var hue = levels[0];

                this.log('... hue is currently %s', hue);
                this.cache.hue = hue;
                callback(null, hue);
            }
        }.bind(this));
    },

    /**
     * Sets the hue of the lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    setHue: function(level, callback) {
        if (this.color && typeof this.color.set_url.url!== 'string') {
            this.log.warn("Ignoring setHue request; problem with 'color' variables.");
            callback(new Error("There was a problem parsing the 'color' section of your configuration."));
            return;
        }
        this.log('Caching Hue as %s ...', level);
        this.cache.hue = level;
        if (this.cacheUpdated) {
            this._setRGB(callback);
        } else {
            this.cacheUpdated = true;
            callback();
        }
    },

    /**
     * Gets the saturation of lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    getSaturation: function(callback) {
        if (this.color && typeof this.color.get_url.url !== 'string') {
            this.log.warn("Ignoring getSaturation request; problem with 'color' variables.");
            callback(new Error("There was a problem parsing the 'color' section of your configuration."));
            return;
        }
        var url = this.color.get_url.url;

        this._httpRequest(url, '', 'GET', function(error, response, responseBody) {
            if (!this._handleHttpErrorResponse('getSaturation()', error, response, responseBody, callback)) {
                var rgb = responseBody;
                var levels = this._rgbToHsl(
                    parseInt(rgb.substr(0,2),16),
                    parseInt(rgb.substr(2,2),16),
                    parseInt(rgb.substr(4,2),16)
                );

                var saturation = levels[1];

                this.log('... saturation is currently %s', saturation);
                this.cache.saturation = saturation;
                callback(null, saturation);
            }
        }.bind(this));
    },

    /**
     * Sets the saturation of the lightbulb.
     *
     * @param {number} level The saturation of the new call.
     * @param {function} callback The callback that handles the response.
     */
    setSaturation: function(level, callback) {
        if (this.color && typeof this.color.set_url.url !== 'string') {
            this.log.warn("Ignoring setSaturation request; problem with 'color' variables.");
            callback(new Error("There was a problem parsing the 'color' section of your configuration."));
            return;
        }
        this.log('Caching Saturation as %s ...', level);
        this.cache.saturation = level;
        if (this.cacheUpdated) {
            this._setRGB(callback);
        } else {
            this.cacheUpdated = true;
            callback();
        }
    },

    /**
     * Sets the RGB value of the device based on the cached HSB values.
     *
     * @param {function} callback The callback that handles the response.
     */
    _setRGB: function(callback) {
        var rgbRequest = this._buildRgbRequest();
        this.cacheUpdated = false;

        this._httpRequest(rgbRequest.url, rgbRequest.body, this.color.http_method, function(error, response, responseBody) {
            if (!this._handleHttpErrorResponse('_setRGB()', error, response, responseBody, callback)) {
                this.log('... _setRGB() successfully set');
                callback();
            }
        }.bind(this));
    },

    _buildRgbRequest: function() {
        var rgb = convert.hsv.rgb([this.cache.hue, this.cache.saturation, this.cache.brightness]);
        var xyz = convert.rgb.xyz(rgb);
        var hex = convert.rgb.hex(rgb);

        if(xyz == null || xyz.size == 0){
           this.log.warn("Can't read the brightness property! Ignoring the request");
           return {url: '', body: ''};
        }


        var xy = {
            x: (xyz[0] / 100 / (xyz[0] / 100 + xyz[1] / 100 + xyz[2] / 100)).toFixed(4),
            y: (xyz[1] / 100 / (xyz[0] / 100 + xyz[1] / 100 + xyz[2] / 100)).toFixed(4)
        };

        var url = this.color.set_url.url;
        var body = this.color.set_url.body;
        var replaces = {
            '%s': hex,
            '%xy-x': xy.x,
            '%xy-y': xy.y
        };
        for (var key in replaces) {
            url = url.replace(key, replaces[key]);
            body = body.replace(key, replaces[key]);
        }

        this.log('_buildRgbRequest converting H:%s S:%s B:%s to RGB:%s ...', this.cache.hue, this.cache.saturation, this.cache.brightness, hex);

        return {url: url, body: body};
    },


    // Utility Functions

    /**
     * Perform an HTTP request.
     *
     * @param {string} url URL to call.
     * @param {string} body Body to send.
     * @param {method} method Method to use.
     * @param {function} callback The callback that handles the response.
     */
    _httpRequest: function(url, body, method, callback) {
        request({
            url: url,
            body: body,
            method: method,
            timeout: this.timeout,
            rejectUnauthorized: false,
            auth: {
                user: this.username,
                pass: this.password
            }},
            function(error, response, body) {
               callback(error, response, body);
        });
    },

    /**
     * Verify if response code equals '200', otherwise log error and callback
     * with a new Error object.
     * @param  {String}   functionStr Description used to create log and error message.
     * @param  {Object}   error       Received error from client.
     * @param  {Object}   response    Received reponse from client.
     * @param  {Function} callback    Reply function to call when error ocurred.
     * @return {Boolean}              true: Error occurred, false otherwise
     */
    _handleHttpErrorResponse: function(functionStr, error, response, responseBody, callback) {
      var errorOccurred = false;
      if (error) {
          this.log(functionStr +' failed: %s', error.message);
          callback(error);
          errorOccurred = true;
      } else if (response.statusCode != 200) {
         this.log(functionStr + ' returned HTTP error code: %s: "%s"', response.statusCode, responseBody);
         callback( new Error("Received HTTP error code " + response.statusCode + ': "' + responseBody + '"') );
         errorOccurred = true;
      }
      return errorOccurred;
   },

    /**
     * Converts an RGB color value to HSL. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
     * Assumes r, g, and b are in [0..255] and
     * returns h in [0..360], and s and l in [0..100].
     *
     * @param   {Number}  r       The red color value
     * @param   {Number}  g       The green color value
     * @param   {Number}  b       The blue color value
     * @return  {Array}           The HSL representation
     */
    _rgbToHsl: function(r, g, b){
        r /= 255;
        g /= 255;
        b /= 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h, s, l = (max + min) / 2;

        if(max == min){
            h = s = 0; // achromatic
        }else{
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch(max){
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        h *= 360; // return degrees [0..360]
        s *= 100; // return percent [0..100]
        l *= 100; // return percent [0..100]
        return [parseInt(h), parseInt(s), parseInt(l)];
    },

    /**
     * Converts a decimal number into a hexidecimal string, with optional
     * padding (default 2 characters).
     *
     * @param   {Number} d        Decimal number
     * @param   {String} padding  Padding for the string
     * @return  {String}          '0' padded hexidecimal number
     */
    _decToHex: function(d, padding) {
        var hex = Number(d).toString(16).toUpperCase();
        padding = typeof (padding) === 'undefined' || padding === null ? padding = 2 : padding;

        while (hex.length < padding) {
            hex = '0' + hex;
        }

        return hex;
    }

};
