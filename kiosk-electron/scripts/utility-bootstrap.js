// Bootstrap script for utility processes
// This script sets up module paths before loading the actual entry point

const path = require('path');
const Module = require('module');

// Get the serialport-modules path from environment or calculate it
const resourcesPath = process.env.RESOURCES_PATH || path.join(__dirname, '..');
const serialportModulesPath = path.join(resourcesPath, 'serialport-modules');

// Add serialport-modules to the module search paths
Module.globalPaths.unshift(serialportModulesPath);

// Also add to NODE_PATH and reinitialize paths
process.env.NODE_PATH =
  serialportModulesPath +
  (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
Module._initPaths();

// Get the actual script to run from command line arguments
const scriptPath = process.argv[2];
if (!scriptPath) {
  console.error('No script path provided to utility-bootstrap.js');
  process.exit(1);
}

// Load and execute the actual script
require(scriptPath);
