/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const path = require('path');
const protobuf = require('protobufjs');
const grpc = require('@grpc/grpc-js');
const { GoogleError } = require('google-gax');

// Import the clients for each version supported by this package.
const gapic = Object.freeze({
  v1beta1: require('./v1beta1'),
});

module.exports.v1beta1 = gapic.v1beta1;

// Alias `module.exports` as `module.exports.default`, for future-proofing.
module.exports.default = Object.assign({}, module.exports);

if (require.main === module) {
  testShowcase().then(
    () => {
      console.log('It works!');
    },
    err => {
      process.exitCode = 1;
      console.log(err);
    }
  );
}

async function testShowcase() {
  const grpcClientOpts = {
    grpc,
    sslCreds: grpc.credentials.createInsecure(),
  };

  const fakeGoogleAuth = {
    getClient: async () => {
      return {
        getRequestHeaders: async () => {
          return {
            Authorization: 'Bearer zzzz',
          };
        },
      };
    },
  };

  const fallbackClientOpts = {
    fallback: true,
    protocol: 'http',
    port: 1337,
    auth: fakeGoogleAuth,
  };

  const grpcClient = new gapic.v1beta1.EchoClient(grpcClientOpts);

  const fallbackClient = new gapic.v1beta1.EchoClient(fallbackClientOpts);

  // assuming gRPC server is started locally
  await testEcho(grpcClient);
  await testEchoError(grpcClient);
  await testExpand(grpcClient);
  await testPagedExpand(grpcClient);
  await testPagedExpandAsync(grpcClient);
  await testCollect(grpcClient);
  await testChat(grpcClient);
  await testWait(grpcClient);

  await testEcho(fallbackClient);
  await testPagedExpand(fallbackClient);
  await testWait(fallbackClient);
  await testPagedExpandAsync(fallbackClient);
}

async function testEcho(client) {
  const request = {
    content: 'test',
  };
  const timer = setTimeout(() => {
    throw new Error('End-to-end testEcho method fails with timeout');
  }, 12000);
  const [response] = await client.echo(request);
  clearTimeout(timer);
  assert.deepStrictEqual(request.content, response.content);
}

async function testEchoError(client) {
  const readFile = util.promisify(fs.readFile);

  const fixtureName = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'test',
    'fixtures',
    'multipleErrors.json'
  );
  const protos_path = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'protos',
    'google',
    'rpc'
  );

  const data = await readFile(fixtureName, 'utf8');
  const root = protobuf.loadSync(
    path.join(protos_path, 'error_details.proto')
  );
  const objs = JSON.parse(data);
  for (const obj of objs) {
    const MessageType = root.lookupType(obj.type);
    const buffer = MessageType.encode(obj.value).finish();
    const request = {
      error: {
        code: 3,
        message: 'Test error',
        details: [{
          type_url: 'type.googleapis.com/' + obj.type,
          value: buffer,
        }],
      },
    };
    const timer = setTimeout(() => {
      throw new Error('End-to-end testEchoError method fails with timeout');
    }, 12000);
    await assert.rejects(() => client.echo(request),
      Error);
    try {
      await client.echo(request);
    } catch (err) {
      clearTimeout(timer);
      assert.strictEqual(JSON.stringify(obj.value),
        JSON.stringify(err.statusDetails[0]));
    }
  }
}



async function testExpand(client) {
  const words = ['nobody', 'ever', 'reads', 'test', 'input'];
  const request = {
    content: words.join(' '),
  };
  const result = await new Promise((resolve, reject) => {
    const stream = client.expand(request);
    const result = [];
    stream.on('data', response => {
      result.push(response.content);
    });
    stream.on('end', () => {
      resolve(result);
    });
    stream.on('error', reject);
  });
  assert.deepStrictEqual(words, result);
}

async function testPagedExpand(client) {
  const words = ['nobody', 'ever', 'reads', 'test', 'input'];
  const request = {
    content: words.join(' '),
    pageSize: 2,
  };
  const timer = setTimeout(() => {
    throw new Error('End-to-end testPagedExpand method fails with timeout');
  }, 12000);
  const [response] = await client.pagedExpand(request);
  clearTimeout(timer);
  const result = response.map(r => r.content);
  assert.deepStrictEqual(words, result);
}

async function testPagedExpandAsync(client) {
  const words = ['nobody', 'ever', 'reads', 'test', 'input'];
  const request = {
    content: words.join(' '),
    pageSize: 2,
  };
  const response = [];
  const iterable = client.pagedExpandAsync(request);
  const timer = setTimeout(() => {
    throw new Error(
      'End-to-end testPagedExpandAsync method fails with timeout'
    );
  }, 12000);
  for await (const resource of iterable) {
    response.push(resource.content);
  }
  clearTimeout(timer);
  assert.deepStrictEqual(words, response);
}

async function testCollect(client) {
  const words = ['nobody', 'ever', 'reads', 'test', 'input'];
  const result = await new Promise((resolve, reject) => {
    const stream = client.collect((err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
    for (const word of words) {
      const request = { content: word };
      stream.write(request);
    }
    stream.end();
  });
  assert.deepStrictEqual(result.content, words.join(' '));
}

async function testChat(client) {
  const words = [
    'nobody',
    'ever',
    'reads',
    'test',
    'input',
    'especially',
    'this',
    'one',
  ];
  const result = await new Promise((resolve, reject) => {
    const result = [];
    const stream = client.chat();
    stream.on('data', response => {
      result.push(response.content);
    });
    stream.on('end', () => {
      resolve(result);
    });
    stream.on('error', reject);
    for (const word of words) {
      stream.write({ content: word });
    }
    stream.end();
  });
  assert.deepStrictEqual(result, words);
}

async function testWait(client) {
  const request = {
    ttl: {
      seconds: 5,
      nanos: 0,
    },
    success: {
      content: 'done',
    },
  };
  const [operation] = await client.wait(request);
  const [response] = await operation.promise();
  assert.deepStrictEqual(response.content, request.success.content);
}
