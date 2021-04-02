// ISC License - Copyright 2018, Sander van Woensel

var expect = require('chai').expect;
var sinon = require('sinon');
var sut = require('../index.js');

// -----------------------------------------------------------------------------
// Hint data
// -----------------------------------------------------------------------------
var TestConfig = function() {
    return {
        "service": "Light",
        "name": "Light A",
        "switch": {
            "status": "http://localhost8080/power/status",
            "notificationID": "notification-id-light-a",
            "notificationPassword": "notification-password",
            "powerOn": "http://localhost:8080/power/set/on",
            "powerOff": "http://localhost:8080/power/set/off"
        },
        "color": {
            "status": "http://localhost:8080/color/status",
            "url": "http://localhost:8080/color/set/%s",
            "brightness": false
        },
        "brightness": {
            "status": "http://localhost:8080/brightness/status",
            "url": "http://localhost:8080/brightness/set/%s"
        }
    };
};

// -----------------------------------------------------------------------------
// Test Suites
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
describe('Homebridge plugin creation', function () {

   beforeEach(function () {
      this.testConfig = new TestConfig();

      // This will also make sure to reset the embedded Sinon stubs.
      this.homebridgeStub = new (require('./homebridge.stub.js'))(this.testConfig);
   });


   it('registers accessory', function () {
      // 1. Arrange
      var spy = sinon.spy(this.homebridgeStub, "registerAccessory");

      // 2. Act
      sut(this.homebridgeStub);

      // 3. Assert
      expect(spy.calledOnce).equal(true);
      expect(spy.getCall(0).args[0]).
             equal('homebridge-http-rgb-push');
      expect(spy.getCall(0).args[1]).
             equal('HttpPushRgb');
   });

   it('constructor registers to didFinishLaunching event', function () {
      // 1. Arrange
      // Stub created in homebridge.stub.js already since required for every construct.

      // 2. Act
      // Let SUT pass correct plugin constructor.
      sut(this.homebridgeStub);

      // 3. Assert
      expect(this.homebridgeStub.on.calledOnce).equal(true);
      expect(this.homebridgeStub.on.firstCall.args[0]).equal('didFinishLaunching');
   });

   it('didFinishLaunching callback registers with notification server', function () {
      // 1. Arrange
      // Stub created in homebridge.stub.js already since required for every construct.
      global.notificationRegistration = sinon.stub();

      // 2. Act
      // Let SUT pass correct didFinishLaunching callback during construction.
      sut(this.homebridgeStub);
      // Call actual didFinishLaunching callback
      this.homebridgeStub.on.firstCall.lastArg();

      // 3. Assert
      expect(global.notificationRegistration.calledOnce).equal(true);
      expect(global.notificationRegistration.firstCall.args[0]).equal('notification-id-light-a');
      expect(global.notificationRegistration.firstCall.lastArg).equal('notification-password');
   });

   it('didFinishLaunching callback does nothing on missing global', function () {
      // 1. Arrange
      // Stub created in homebridge.stub.js already since required for every construct.
      // Do not create: global.notificationRegistration

      // 2. Act
      // Let SUT pass correct didFinishLaunching callback during construction.
      sut(this.homebridgeStub);
      // Call actual didFinishLaunching callback
      this.homebridgeStub.on.firstCall.lastArg();

      // 3. Assert
      expect(global.notificationRegistration.calledOnce).equal(false);
   });

   it('sets switch.status.bodyRegEx by default to /1/', function () {
      // 1. Arrange
      // Default TestConfig sets status URL only and should yield default bodyRegEx.

      // 2. Act
      sut(this.homebridgeStub);

      // 3. Assert
      expect(this.homebridgeStub.accessory.switch.status.bodyRegEx).to.eql(new RegExp(/1/));
   });

   it('sets switch.status.bodyRegEx to /"switch": "on"/', function () {
      // 1. Arrange
      this.testConfig.switch.status = {'bodyRegEx': '"switch": "on"' };

      // 2. Act
      sut(this.homebridgeStub);

      // 3. Assert
      expect(this.homebridgeStub.accessory.switch.status.bodyRegEx).to.eql(new RegExp(/"switch": "on"/));
   });

   it('sets switch.status.bodyRegEx to /1/ on incorrect bodyRegEx type', function () {
      // 1. Arrange
      this.testConfig.switch.status = {'bodyRegEx': undefined };

      // 2. Act
      sut(this.homebridgeStub);

      // 3. Assert
      expect(this.homebridgeStub.accessory.switch.status.bodyRegEx).to.eql(new RegExp(/1/));
   });

   it('sets color.get_url on legacy color.status config string', function () {
      // 1. Arrange
      // Default TestConfig sets color.status URL already.

      // 2. Act
      sut(this.homebridgeStub);

      // 3. Assert
      expect(this.homebridgeStub.accessory.color.get_url.url).to.eql("http://localhost:8080/color/status");
   });

   it('sets color.set_url on legacy color.url config string', function () {
      // 1. Arrange
      // Default TestConfig sets color.url URL already.

      // 2. Act
      sut(this.homebridgeStub);

      // 3. Assert
      expect(this.homebridgeStub.accessory.color.set_url.url).to.eql("http://localhost:8080/color/set/%s");
   });

   it('sets color.set_url on new style color.url config object', function () {
      // 1. Arrange
      this.testConfig.color.url = {'url': "http://example.com" };

      // 2. Act
      sut(this.homebridgeStub);

      // 3. Assert
      expect(this.homebridgeStub.accessory.color.set_url.url).to.eql("http://example.com");
   });

});


// -----------------------------------------------------------------------------
describe('Get power state', function () {

   beforeEach(function () {
      // 1. Arrange
      this.testConfig = new TestConfig();

      // This will also make sure to reset the embedded Sinon stubs.
      this.homebridgeStub = new (require('./homebridge.stub.js'))(this.testConfig);
      sut(this.homebridgeStub);

      this.homebridgeStub.accessory._httpRequest = sinon.stub();
      this.homebridgeCallback = sinon.stub();

      // 2. Act
      // Allow getPowerState to create HTTP response callback
      this.homebridgeStub.accessory.getPowerState(this.homebridgeCallback);
   });


   it('sends HTTP GET request with correct URL', function () {
      // 3. Assert
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[0]).equals(this.testConfig.switch.status);
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[1]).to.be.empty; // Body empty.
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[2]).equals('GET');
   });

   it('replies "true" to Homebridge on valid HTTP GET device response "1"', function () {
      // 2. Act
      // Call collected HTTP response callback to simulate device response.
      this.homebridgeStub.accessory._httpRequest.firstCall.callback(undefined, {statusCode: 200}, '1');

      // 3. Assert
      expect(this.homebridgeCallback.firstCall.args[1]).equals(true);
      expect(this.homebridgeStub.logger.firstCall.args).deep.equals(['power is currently %s', 'ON']);
   });

   it('replies "false" to Homebridge on valid HTTP GET device response "0"', function () {
      // 2. Act
      // Call collected HTTP response callback to simulate device response.
      this.homebridgeStub.accessory._httpRequest.firstCall.callback(undefined, {statusCode: 200}, '0');

      // 3. Assert
      expect(this.homebridgeCallback.firstCall.args[1]).equals(false);
      expect(this.homebridgeStub.logger.firstCall.args).deep.equals(['power is currently %s', 'OFF']);
   });

   it('replies "true" to Homebridge on valid HTTP GET device response "{"switch": "on"}"', function () {
      // 1. Arrange
      this.homebridgeStub.accessory.switch.status = {bodyRegEx: new RegExp(/"switch": "on"/), url: 'dummy' };

      // 2. Act
      // Call collected HTTP response callback to simulate device response.
      this.homebridgeStub.accessory._httpRequest.firstCall.callback(undefined, {statusCode: 200}, '{"switch": "on"}');

      // 3. Assert
      expect(this.homebridgeCallback.firstCall.args[1]).equals(true);
      expect(this.homebridgeStub.logger.firstCall.args).deep.equals(['power is currently %s', 'ON']);
   });

   it('replies an Error object with message "Got HTTP error code 404." to Homebridge on HTTP GET device response status code 404', function () {
      // 1. Arrange
      const HTTP_ERROR_STATUS_CODE = 404;

      // 2. Act
      // Call collected HTTP response callback to simulate device response.
      this.homebridgeStub.accessory._httpRequest.firstCall.callback(undefined, {statusCode: HTTP_ERROR_STATUS_CODE}, 'Dummy error');

      // 3. Assert
      expect(this.homebridgeCallback.firstCall.args[0]).to.be.instanceOf(Error).and.have.property('message', 'Received HTTP error code '+HTTP_ERROR_STATUS_CODE+': "Dummy error"');
      expect(this.homebridgeStub.logger.firstCall.args).deep.equals(['getPowerState() returned HTTP error code: %s: "%s"', HTTP_ERROR_STATUS_CODE, 'Dummy error']);
   });

});

// -----------------------------------------------------------------------------
describe('Set brightness', function () {

   beforeEach(function () {
      // 1. Arrange
      this.testConfig = new TestConfig();

      // This will also make sure to reset the embedded Sinon stubs.
      this.homebridgeStub = new (require('./homebridge.stub.js'))(this.testConfig);
      sut(this.homebridgeStub);

      this.homebridgeStub.accessory._httpRequest = sinon.stub();
      this.homebridgeCallback = sinon.stub();

   });


   it('sends HTTP GET request with correct URL', function () {
      // 1. Arrange
      var url = this.testConfig.brightness.url.replace('%s', 100);

      // 2. Act
      this.homebridgeStub.accessory.setBrightness(100, this.homebridgeCallback);

      // 3. Assert
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[0]).equals(url);
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[1]).to.be.empty; // Body empty.
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[2]).equals('GET');
   });

   it('replies to Homebridge on valid HTTP GET device response "100"', function () {
      // 2. Act
      // Trigger filling of callback
      this.homebridgeStub.accessory.setBrightness(100, this.homebridgeCallback);
      // Call collected HTTP response callback to simulate device response.
      this.homebridgeStub.accessory._httpRequest.firstCall.callback(undefined, {statusCode: 200}, '100');

      // 3. Assert
      expect(this.homebridgeCallback.calledOnce).to.be.true;
      expect(this.homebridgeStub.logger.firstCall.args).deep.equals(['Caching Brightness as %s ...', 100]);
      expect(this.homebridgeStub.logger.secondCall.args).deep.equals(['setBrightness() successfully set to %s%', 100]);
   });

   it('sets RGB instead of brightness to Homebridge when config.color.brightness equals true', function () {
      // 1. Arrange
      this.homebridgeStub.accessory.color.brightness = true;

      // 2. Act
      // Trigger filling of callback
      this.homebridgeStub.accessory.setBrightness(100, this.homebridgeCallback);
      // Call collected HTTP response callback to simulate device response.
      this.homebridgeStub.accessory._httpRequest.firstCall.callback(undefined, {statusCode: 200}, '100');

      // 3. Assert
      expect(this.homebridgeCallback.calledOnce).to.be.true; // But now inside _buildRgbRequest.
      expect(this.homebridgeStub.logger.secondCall.args).deep.equals(['Setting brightness via RGB.']);
      expect(this.homebridgeStub.logger.firstCall.args).deep.equals(['Caching Brightness as %s ...', 100]);
      expect(this.homebridgeStub.logger.thirdCall.args[0]).deep.equals('_buildRgbRequest converting H:%s S:%s B:%s to RGB:%s ...');
      expect(this.homebridgeStub.logger.getCall(3).args).deep.equals(['... _setRGB() successfully set']);
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[0]).not.to.be.empty;

   });

   it('replies an Error object with message "Received HTTP error code 500." to Homebridge on HTTP GET device response status code 500', function () {
      // 1. Arrange
      const HTTP_ERROR_STATUS_CODE = 500;

      // 2. Act
      // Trigger filling of callback
      this.homebridgeStub.accessory.setBrightness(100, this.homebridgeCallback);
      // Call collected HTTP response callback to simulate device response.
      this.homebridgeStub.accessory._httpRequest.firstCall.callback(undefined, {statusCode: HTTP_ERROR_STATUS_CODE}, 'Dummy error');

      // 3. Assert
      expect(this.homebridgeCallback.firstCall.args[0]).to.be.instanceOf(Error).and.have.property('message', 'Received HTTP error code '+HTTP_ERROR_STATUS_CODE+': "Dummy error"');
      expect(this.homebridgeStub.logger.firstCall.args).deep.equals(['Caching Brightness as %s ...', 100]);
      expect(this.homebridgeStub.logger.secondCall.args).deep.equals(['setBrightness() returned HTTP error code: %s: "%s"', HTTP_ERROR_STATUS_CODE, 'Dummy error']);
   });

});

// -----------------------------------------------------------------------------
describe('Get hue', function () {

   beforeEach(function () {
      // 1. Arrange
      this.testConfig = new TestConfig();

      // This will also make sure to reset the embedded Sinon stubs.
      this.homebridgeStub = new (require('./homebridge.stub.js'))(this.testConfig);
      sut(this.homebridgeStub);

      this.homebridgeStub.accessory._httpRequest = sinon.stub();
      this.homebridgeCallback = sinon.stub();

      // 2. Act
      // Allow getHue to create HTTP response callback
      this.homebridgeStub.accessory.getHue(this.homebridgeCallback);
   });


   it('sends HTTP GET request with correct URL', function () {
      // 1. Arrange
      var url = this.testConfig.color.status;

      // 3. Assert
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[0]).equals(url);
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[1]).to.be.empty; // Body empty.
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[2]).equals('GET');
   });

   it('replies "0" to Homebridge on valid HTTP GET device response "ffffff"', function () {
      // 2. Act
      // Call collected HTTP response callback to simulate device response.
      this.homebridgeStub.accessory._httpRequest.firstCall.callback(undefined, {statusCode: 200}, 'ffffff');

      // 3. Assert
      expect(this.homebridgeCallback.firstCall.args[1]).equals(0);
      expect(this.homebridgeStub.logger.firstCall.args).deep.equals(['... hue is currently %s. RGB: %s', 0, 'ffffff']);
   });

});


// -----------------------------------------------------------------------------
describe('Get saturation', function () {

   beforeEach(function () {
      // 1. Arrange
      this.testConfig = new TestConfig();

      // This will also make sure to reset the embedded Sinon stubs.
      this.homebridgeStub = new (require('./homebridge.stub.js'))(this.testConfig);
      sut(this.homebridgeStub);

      this.homebridgeStub.accessory._httpRequest = sinon.stub();
      this.homebridgeCallback = sinon.stub();

      // 2. Act
      // Allow getSaturation to create HTTP response callback
      this.homebridgeStub.accessory.getSaturation(this.homebridgeCallback);
   });


   it('sends HTTP GET request with correct URL', function () {
      // 1. Arrange
      var url = this.testConfig.color.status;

      // 2. Act
      this.homebridgeStub.accessory.getSaturation(this.homebridgeCallback);

      // 3. Assert
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[0]).equals(url);
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[1]).to.be.empty; // Body empty.
      expect(this.homebridgeStub.accessory._httpRequest.firstCall.args[2]).equals('GET');
   });

   it('replies "0" to Homebridge on valid HTTP GET device response "ffffff"', function () {
      // 2. Act
      // Call collected HTTP response callback to simulate device response.
      this.homebridgeStub.accessory._httpRequest.firstCall.callback(undefined, {statusCode: 200}, 'ffffff');

      // 3. Assert
      expect(this.homebridgeCallback.firstCall.args[1]).equals(0);
      expect(this.homebridgeStub.logger.firstCall.args).deep.equals(['... saturation is currently %s. RGB: %s', 0, 'ffffff']);
   });

});


// -----------------------------------------------------------------------------
describe('Get services', function () {

   beforeEach(function () {
      // 1. Arrange
      this.testConfig = new TestConfig();

      // This will also make sure to reset the embedded Sinon stubs.
      this.homebridgeStub = new (require('./homebridge.stub.js'))(this.testConfig);
      sut(this.homebridgeStub);


   });

   it('contains model, manufacturer, serial number and firmware revision sourced from package.json', function() {
      // 1. Arrange
      const PACKAGE = require('../package.json');

      // 2. Act
      var services = this.homebridgeStub.accessory.getServices();

      // 3. Assert
      expect(services[0].setCharacteristic.firstCall.lastArg).to.equal(PACKAGE.author.name);
      expect(services[0].setCharacteristic.secondCall.lastArg).to.equal("001");
      expect(services[0].setCharacteristic.thirdCall.lastArg).to.equal(PACKAGE.name);
      expect(services[0].setCharacteristic.lastCall.lastArg).to.equal(PACKAGE.version);
   });



});
