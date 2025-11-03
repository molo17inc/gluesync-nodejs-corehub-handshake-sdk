/**
 * This file is part of Gluesync SDK.
 *
 * Gluesync SDK is dual-licensed under the following licenses:
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

import * as fs from 'fs/promises';
import * as tls from 'tls';
import { randomBytes } from 'crypto';

/**
 * Parse a WebSocket close reason into error code and message.
 *
 * @param reason - The close reason string from the WebSocket
 * @returns Tuple of [errorCode, errorMessage]
 */
export const parseCloseReason = (reason: string): [string, string] => {
  if (reason.includes(':')) {
    const parts = reason.split(':', 2);
    return [parts[0].trim(), parts[1].trim()];
  }
  return ['UNKNOWN', reason];
};

/**
 * Extract a user-friendly error message from a close reason.
 *
 * @param reason - The close reason string from the WebSocket
 * @returns An error message suitable for display to the user
 */
export const getErrorFromCloseReason = (reason: string): string => {
  const [errorCode, errorMessage] = parseCloseReason(reason);

  const errorMessages: Record<string, string> = {
    NOT_CONSISTENT:
      'Authentication failed: Invalid headers or license information',
    VIOLATED_POLICY: 'License not valid or expired',
    INTERNAL_ERROR:
      'Server error: Please check CoreHub logs for more information',
    CLOSED_ABNORMALLY: 'Connection closed unexpectedly',
  };

  return errorMessages[errorCode] || errorMessage;
};

/**
 * Create a promise that rejects after a specified timeout.
 *
 * @param ms - Timeout in milliseconds
 * @param message - Error message
 * @returns A promise that rejects after the timeout
 */
export const createTimeout = (ms: number, message: string): Promise<never> =>
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });

/**
 * Generate a random ID for tracking purposes.
 *
 * @returns certificatePassword and certificateKeyPassword
 */
export const generateId = (): string => randomBytes(8).toString('hex');

/**
 * Create SSL context from certificate and key files
 */
export const createSslContext = async (
  certPath: string,
  keyPath: string,
  password?: string,
): Promise<tls.ConnectionOptions> => {
  try {
    const cert = await fs.readFile(certPath);
    const key = await fs.readFile(keyPath);

    return {
      cert,
      key,
      passphrase: password,
    };
  } catch (error) {
    throw new Error(`Failed to create SSL context: ${error}`);
  }
};

/**
 * Load credentials from security config or environment
 */
export const loadCredentials = async (
  securityConfigPath?: string,
): Promise<{
  certPath: string;
  keyPath: string;
  password?: string;
}> => {
  if (!securityConfigPath) {
    return {
      certPath: process.env.SSL_CERT_FILE || '',
      keyPath: process.env.SSL_KEY_FILE || '',
      password: process.env.SSL_CERT_PASSWORD,
    };
  }

  try {
    const configRaw = await fs.readFile(securityConfigPath, 'utf8');
    const config = JSON.parse(configRaw);

    if (config.ssl) {
      return {
        certPath: process.env.SSL_CERT_FILE || '',
        keyPath: process.env.SSL_KEY_FILE || '',
        password:
          config.ssl.certificatePassword || process.env.SSL_CERT_PASSWORD,
      };
    }
    else {
      console.log('Security config file not found, using environment variables');
    }
  } catch (error) {
    console.warn(
      'Could not read security config file, using environment variables',
    );
  }

  return {
    certPath: process.env.SSL_CERT_FILE || '',
    keyPath: process.env.SSL_KEY_FILE || '',
    password: process.env.SSL_CERT_PASSWORD,
  };
};
