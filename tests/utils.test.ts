/**
 * Tests for the utils module.
 */

import * as fs from 'fs-extra';
import * as JSZip from 'jszip';
import * as forge from 'node-forge';
import { 
  createSslContextFromJks,
  createTimeout,
  getErrorFromCloseReason,
  generateId
} from '../src/utils';
import { GluesyncSSLError } from '../src/exceptions';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('jszip');
jest.mock('node-forge');

describe('utils', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });
  
  describe('createSslContextFromJks', () => {
    beforeEach(() => {
      // Mock fs.readFile to return mock JKS data
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock-jks-data') as any);
      
      // Mock JSZip.loadAsync to return a mock zip object
      const mockZip = {
        files: {
          'certificate.pem': {
            async: jest.fn().mockResolvedValue('mock-certificate')
          },
          'private.key': {
            async: jest.fn().mockResolvedValue('mock-private-key')
          },
          'ca.pem': {
            async: jest.fn().mockResolvedValue('mock-ca')
          }
        }
      };
      jest.spyOn(JSZip, 'loadAsync').mockResolvedValue(mockZip as any);
      
      // Mock forge.pki functions
      jest.spyOn(forge.pki, 'certificateFromPem').mockReturnValue({
        publicKey: 'mock-public-key'
      } as any);
      
      jest.spyOn(forge.pki, 'privateKeyFromPem').mockReturnValue('mock-private-key-object' as any);
      jest.spyOn(forge.pki, 'publicKeyToPem').mockReturnValue('mock-public-key-pem');
      jest.spyOn(forge.pki, 'privateKeyToPem').mockReturnValue('mock-private-key-pem');
    });
    
    test('should create SSL context from JKS file', async () => {
      // Call the function
      const sslOptions = await createSslContextFromJks('keystore.jks', 'password');
      
      // Verify that fs.readFile was called with the correct path
      expect(fs.readFile).toHaveBeenCalledWith('keystore.jks');
      
      // Verify that JSZip.loadAsync was called with the mock JKS data
      expect(JSZip.loadAsync).toHaveBeenCalledWith(Buffer.from('mock-jks-data'));
      
      // Verify the SSL options
      expect(sslOptions).toEqual({
        ca: 'mock-ca',
        cert: 'mock-certificate',
        key: 'mock-private-key-pem'
      });
    });
    
    test('should handle errors when reading JKS file', async () => {
      // Mock fs.readFile to throw an error
      jest.spyOn(fs, 'readFile').mockRejectedValue(new Error('File not found') as any);
      
      // Expect createSslContextFromJks to throw a GluesyncSSLError
      await expect(createSslContextFromJks('keystore.jks', 'password'))
        .rejects.toThrow(GluesyncSSLError);
    });
    
    test('should handle errors when parsing JKS file', async () => {
      // Mock JSZip.loadAsync to throw an error
      jest.spyOn(JSZip, 'loadAsync').mockRejectedValue(new Error('Invalid JKS file'));
      
      // Expect createSslContextFromJks to throw a GluesyncSSLError
      await expect(createSslContextFromJks('keystore.jks', 'password'))
        .rejects.toThrow(GluesyncSSLError);
    });
  });
  
  describe('createTimeout', () => {
    test('should resolve after the specified timeout', async () => {
      // Mock setTimeout
      jest.useFakeTimers();
      
      // Create a timeout promise
      const timeoutPromise = createTimeout(1000, 'Test timeout');
      
      // Advance timers
      jest.advanceTimersByTime(1000);
      
      // Verify that the promise resolves with the expected message
      await expect(timeoutPromise).resolves.toBe('Test timeout');
      
      // Restore timers
      jest.useRealTimers();
    });
  });
  
  describe('getErrorFromCloseReason', () => {
    test('should return the close reason', () => {
      expect(getErrorFromCloseReason('Test reason')).toBe('Test reason');
    });
    
    test('should return a default message for empty reason', () => {
      expect(getErrorFromCloseReason('')).toBe('Connection closed');
    });
  });
  
  describe('generateId', () => {
    test('should generate a random ID', () => {
      const id = generateId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });
});
