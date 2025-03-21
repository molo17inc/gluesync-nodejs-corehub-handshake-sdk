/**
 * This file is part of Gluesync Scheduler Module.
 *
 * Gluesync Scheduler Module is dual-licensed under the following licenses:
 *
 * 1. GNU General Public License (GPL) Version 3
 *    You may use, modify, and distribute this software under the terms of the GPL v3.
 *    See the LICENSE-GPL file or <http://www.gnu.org/licenses/gpl-3.0.html> for details.
 *    This option is available at no cost, but any derivative works must also be licensed under GPL v3.
 *
 * 2. MOLO17 Commercial License
 *    Alternatively, you may use this software under the MOLO17 Commercial License,
 *    which includes a warranty and permits proprietary use. Contact MOLO17 at info@molo17.com
 *    for licensing terms and conditions.
 *
 * You must choose one of these licenses to use this software. Using this software implies
 * acceptance of one of these licenses. See the accompanying LICENSE files or contact
 * MOLO17 for more information.
 *
 * Copyright (C) 2025 MOLO17. All rights reserved.
 */

import * as fs from 'fs-extra';
import * as forge from 'node-forge';
import * as tls from 'tls';
import JSZip from 'jszip';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { GluesyncSSLError } from './exceptions';

/**
 * Create an SSL/TLS context from a Java KeyStore (JKS) file.
 *
 * @param keystorePath - Path to the JKS file
 * @param keystorePassword - Password for the JKS file
 * @returns SSL/TLS options object for use with Node.js tls/https module
 * @throws GluesyncSSLError if keystore processing fails
 */
export async function createSslContextFromJks(
  keystorePath: string,
  keystorePassword: string
): Promise<tls.ConnectionOptions> {
  try {
    // Read the JKS file
    const jksData = await fs.readFile(keystorePath);
    
    // Parse the JKS file using JSZip
    const zip = await JSZip.loadAsync(jksData);
    
    // Look for certificates
    const certs: string[] = [];
    
    // Process each file in the JKS
    for (const [filename, file] of Object.entries(zip.files)) {
      if (filename.endsWith('.cert') || filename.endsWith('.crt') || filename.endsWith('.pem')) {
        const content = await file.async('string');
        
        // Verify this is a PEM certificate
        if (content.includes('-----BEGIN CERTIFICATE-----')) {
          certs.push(content);
        } else {
          // Try to convert DER to PEM if needed
          try {
            const derBytes = forge.util.createBuffer(content);
            const asn1 = forge.asn1.fromDer(derBytes);
            const cert = forge.pki.certificateFromAsn1(asn1);
            const pemCert = forge.pki.certificateToPem(cert);
            certs.push(pemCert);
          } catch (e) {
            console.warn('Failed to parse certificate:', e);
          }
        }
      }
    }
    
    if (certs.length === 0) {
      throw new GluesyncSSLError('No valid certificates found in the keystore');
    }
    
    // Return TLS options with the certificates
    return {
      ca: certs,
      checkServerIdentity: () => undefined, // Skip hostname verification
      rejectUnauthorized: true
    };
  } catch (error) {
    if (error instanceof GluesyncSSLError) {
      throw error;
    }
    throw new GluesyncSSLError(`Failed to create SSL context: ${error}`);
  }
}

/**
 * Parse a WebSocket close reason into error code and message.
 *
 * @param reason - The close reason string from the WebSocket
 * @returns Tuple of [errorCode, errorMessage]
 */
export function parseCloseReason(reason: string): [string, string] {
  if (reason.includes(':')) {
    const parts = reason.split(':', 2);
    return [parts[0].trim(), parts[1].trim()];
  }
  return ['UNKNOWN', reason];
}

/**
 * Extract a user-friendly error message from a close reason.
 *
 * @param reason - The close reason string from the WebSocket
 * @returns An error message suitable for display to the user
 */
export function getErrorFromCloseReason(reason: string): string {
  const [errorCode, errorMessage] = parseCloseReason(reason);
  
  const errorMessages: Record<string, string> = {
    'NOT_CONSISTENT': 'Authentication failed: Invalid headers or license information',
    'VIOLATED_POLICY': 'License not valid or expired',
    'INTERNAL_ERROR': 'Server error: Please check CoreHub logs for more information',
    'CLOSED_ABNORMALLY': 'Connection closed unexpectedly'
  };
  
  return errorMessages[errorCode] || errorMessage;
}

/**
 * Create a promise that rejects after a specified timeout.
 *
 * @param ms - Timeout in milliseconds
 * @param message - Error message
 * @returns A promise that rejects after the timeout
 */
export function createTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/**
 * Generate a random ID for tracking purposes.
 * 
 * @returns A random string ID
 */
export function generateId(): string {
  return randomBytes(8).toString('hex');
}
