// __tests__/utils.test.ts

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { exportJWK, generateKeyPair } from 'jose';
import { DynamicSLBloomFilter2023 } from '../dynamic-sl-bloom-filter-2023';
import { DynamicSLBloomFilter2023Config } from '../dto/dynamic-sl-bloom-filter-2023-config';
import { createSecret, hmac } from '../util';
import { BloomFilterVerifier } from '../bloom-filter-verifier';
import { createCredentialStatusToken } from '../holder';
import {
  DEFAULT_SIZE,
  DEFAULT_FALSE_POSITIVE,
  DEFAULT_NBHASHES,
  DEFAULT_EPOCH,
} from '../const';
import { CredentialStatusToken } from '../dto/credential-status-token';

// paths where the key pair is stored
const privateKeyPath = 'tmp/jwk.private.json';
const publicKeyPath = 'tmp/jwk.public.json';

// issuer reference of the vc statuslist
const issuer = 'did:web:exmaple.com';

// algorithm used to sign the vc
const alg = 'ES256';

// path where the schema is located. Required for the vc-issuer to validate the vc
const dynamicSLBloomFilter2023Schema = 'pathToTheSchema';

/**
 * Creates the key pair if it does not exist.
 */
async function init() {
  if (!existsSync('tmp')) {
    mkdirSync('tmp');
  }
  if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
    const { privateKey, publicKey } = await generateKeyPair(alg);
    writeFileSync(privateKeyPath, JSON.stringify(await exportJWK(privateKey)));
    writeFileSync(publicKeyPath, JSON.stringify(await exportJWK(publicKey)));
  }
}

function getPrivateKey() {
  return JSON.parse(readFileSync(privateKeyPath, 'utf-8'));
}

describe('bloom list 2023', () => {
  beforeAll(async () => {
    await init();
  });

  it('creates a list', () => {
    const config: DynamicSLBloomFilter2023Config = {
      dynamicSLBloomFilter2023Schema,
      id: randomUUID(),
      issuer,
      epoch: DEFAULT_EPOCH,
      falsePositive: DEFAULT_FALSE_POSITIVE,
      nbHashes: DEFAULT_NBHASHES,
      purpose: 'revocation',
      size: DEFAULT_SIZE,
    };
    const statuslist = new DynamicSLBloomFilter2023(config);
    expect(statuslist).toBeDefined();
  });
  it('is a value in the list', async () => {
    const config: DynamicSLBloomFilter2023Config = {
      dynamicSLBloomFilter2023Schema,
      id: randomUUID(),
      issuer,
    };
    const statuslist = new DynamicSLBloomFilter2023(config);
    const id = randomUUID();
    const secret = createSecret();
    const credentialStatusVc = await statuslist.addValid(id, secret);
    const dynamicSLBloomFilter2023VC = statuslist.createVc();

    const verifier = new BloomFilterVerifier({
      vc: dynamicSLBloomFilter2023VC,
    });
    // create the token
    const holderDid = 'did:web:holder.example.com';
    const vcToken = await createCredentialStatusToken(
      credentialStatusVc,
      holderDid
    );
    expect(await verifier.isValid(vcToken)).toBe(true);

    vcToken.credentialSubject.token = 'invalidValue';
    expect(await verifier.isValid(vcToken)).toBe(false);
  });

  it('check with an expired vc', async () => {
    const config: DynamicSLBloomFilter2023Config = {
      dynamicSLBloomFilter2023Schema,
      id: randomUUID(),
      issuer,
    };
    const statuslist = new DynamicSLBloomFilter2023(config);
    const id = randomUUID();
    const secret = createSecret();
    const credentialStatusVc = await statuslist.addValid(id, secret);
    const dynamicSLBloomFilter2023VC = statuslist.createVc();

    const expired = new Date();
    expired.setFullYear(expired.getFullYear() - 1);
    dynamicSLBloomFilter2023VC.validUntil = expired.toISOString();
    const verifier = new BloomFilterVerifier({
      vc: dynamicSLBloomFilter2023VC,
      timeCheck: true,
      size: DEFAULT_SIZE,
      falsePositive: DEFAULT_FALSE_POSITIVE,
      nbHashes: DEFAULT_NBHASHES,
    });
    // create the token
    const holderDid = 'did:web:holder.example.com';
    const vcToken = await createCredentialStatusToken(
      credentialStatusVc,
      holderDid
    );
    await expect(verifier.isValid(vcToken)).rejects.toThrow(
      'Bloom filter is no longer valid'
    );
  });

  it('revoce a value in the list', async () => {
    const config: DynamicSLBloomFilter2023Config = {
      dynamicSLBloomFilter2023Schema,
      id: randomUUID(),
      issuer,
    };
    const statuslist = new DynamicSLBloomFilter2023(config);
    const id = randomUUID();
    const secret = createSecret();
    await statuslist.addInvalid(id, secret);
    const dynamicSLBloomFilter2023VC = statuslist.createVc();

    const verifier = new BloomFilterVerifier({
      vc: dynamicSLBloomFilter2023VC,
    });
    const duration = Math.floor(Date.now() / 1000 / DEFAULT_EPOCH);
    const token = await hmac(duration.toString(), secret);
    // create a dummy vc because the valid function requires one
    const vc: CredentialStatusToken = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: [
        'VerifiableCredential',
        'VerifiableAttestation',
        'CredentialStatusToken',
      ],
      credentialSchema: {
        id: '',
        type: 'FullJsonSchemaValidator2021',
      },
      expirationDate: '',
      credentialSubject: {
        id,
        token,
      },
      issuanceDate: '',
      validUntil: '',
      id: '',
      issuer: '',
      validFrom: '',
    };
    expect(await verifier.isValid(vc)).toBe(false);
  });
});
