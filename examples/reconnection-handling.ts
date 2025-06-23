/**
 * Advanced example demonstrating automatic reconnection handling with the Gluesync SDK.
 * 
 * This example demonstrates the automatic reconnection handling functionality
 * built into the Gluesync client.
 *
 * The client automatically handles reconnection when disconnected from CoreHub,
 * with exponential backoff and configurable retry settings.
 * 
 * This example shows:
 * 1. Setting up a GluesyncClient with event handlers
 * 2. Automatic reconnection with exponential backoff
 * 3. Handling various connection events
 * 4. Graceful shutdown
 * 
 * Usage:
 * - Make sure you have a valid gs-license.dat file in the current directory
 * - Set the CORE_HUB_ADDRESS environment variable or use autodiscovery
 * - Run with: npx ts-node reconnection-handling.ts
 */

import { GluesyncClient } from '../src';

// Set up logging
const DEBUG = process.env.DEBUG || 'gluesync:*';
process.env.DEBUG = DEBUG;

// Configuration
const config = {
  host: 'localhost',  // Use null for auto-discovery
  port: 1717,
  licenseFilePath: '../gs-license.dat',
  moduleTag: 'nodejs-example',
  ssl: false
  // Note: Reconnection settings are now handled internally by the SDK
};

class GluesyncClientManager {
  private client: GluesyncClient;
  private isShuttingDown: boolean = false;
  private currentToken: string | null = null;
  
  constructor() {
    // Create the client
    this.client = new GluesyncClient({
      host: config.host,
      port: config.port,
      licenseFilePath: config.licenseFilePath,
      moduleTag: config.moduleTag,
      ssl: config.ssl
    });
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Set up process signal handlers for graceful shutdown
    this.setupSignalHandlers();
    
    // Track the current token
    this.currentToken = null;
  }
  
  /**
   * Set up event handlers for the client
   */
  private setupEventHandlers(): void {
    // Connected event
    this.client.onConnected = (token) => {
      console.log(`Connected to CoreHub successfully!`);
      console.log(`Received token: ${token.substring(0, 20)}...`);
    };
    
    // Disconnected event
    this.client.onDisconnected = (reason) => {
      console.log(`Disconnected from CoreHub: ${reason}`);
      console.log('SDK will automatically attempt to reconnect...');
      // Note: Reconnection is now handled automatically by the SDK
    };
    
    // Error event
    this.client.onError = (error) => {
      console.error(`Error occurred: ${error.message}`);
    };
    
    // Token update event
    this.client.onTokenUpdated = (token) => {
      if (this.currentToken !== token) {
        const oldToken = this.currentToken;
        this.currentToken = token;
        
        if (oldToken) {
          console.log('Token has been updated after reconnection.');
          console.log(`Previous token: ${oldToken.substring(0, 10)}... New token: ${token.substring(0, 10)}...`);
        } else {
          console.log(`Received initial token: ${token.substring(0, 10)}...`);
        }
        
        // This is where you would update any services that depend on the token
        this.updateDependentServices(token);
      }
    };
    
    // New SDK reconnection events
    
    // Reconnecting event - called when the SDK starts attempting to reconnect
    this.client.onReconnecting = () => {
      console.log('Reconnecting to CoreHub...');
    };
    
    // Reconnected event - called when the SDK successfully reconnects
    this.client.onReconnected = (token) => {
      console.log('Successfully reconnected to CoreHub!');
      console.log(`Reconnection token: ${token.substring(0, 20)}...`);
    };
  }
  
  /**
   * Set up process signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      console.log('\nReceived SIGINT signal. Shutting down gracefully...');
      await this.shutdown();
      process.exit(0);
    });
    
    // Handle SIGTERM
    process.on('SIGTERM', async () => {
      console.log('\nReceived SIGTERM signal. Shutting down gracefully...');
      await this.shutdown();
      process.exit(0);
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error(`Uncaught exception: ${error.message}`);
      console.error(error.stack);
      await this.shutdown();
      process.exit(1);
    });
  }
  
  /**
   * Connect to CoreHub
   */
  public async connect(): Promise<void> {
    try {
      console.log('Connecting to CoreHub...');
      await this.client.connect();
      console.log(`Connection status: ${this.client.connectionStatus}`);
    } catch (error) {
      console.error(`Failed to connect: ${error}`);
      // Note: The SDK will automatically attempt to reconnect
    }
  }
  
  /**
   * Update any dependent services that use the token
   * 
   * @param token - The new authentication token
   */
  private updateDependentServices(token: string): void {
    // Example: Update token in other services that need it
    console.log('Updating token in dependent services...');
    // Example only - in reality, you would update your actual services:
    // myChronosApp.updateToken(token);
    // myApiClient.setAuthToken(token);
  }
  
  /**
   * Gracefully shut down the client
   */
  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    // Disconnect if connected
    if (this.client.isConnected) {
      console.log('Disconnecting from CoreHub...');
      try {
        await this.client.disconnect();
        console.log('Disconnected successfully.');
      } catch (error) {
        console.error(`Error during disconnection: ${error}`);
      }
    }
  }
}

/**
 * Main function to run the example
 */
async function main() {
  console.log('Starting Gluesync CoreHub reconnection example...');
  
  // Create the client manager
  const clientManager = new GluesyncClientManager();
  
  // Connect to CoreHub
  await clientManager.connect();
  
  // Keep the process running
  console.log('Example is running. Press Ctrl+C to exit.');
}

// Run the example
main().catch(console.error);
