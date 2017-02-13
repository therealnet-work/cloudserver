import assert from 'assert';
import async from 'async';
import { parseString } from 'xml2js';

import { errors } from 'arsenal';

import { cleanup, DummyRequestLogger } from '../helpers';
import config from '../../../lib/Config';
import DummyRequest from '../DummyRequest';
import bucketPut from '../../../lib/api/bucketPut';
import initiateMultipartUpload
    from '../../../lib/api/initiateMultipartUpload';
import multipartDelete from '../../../lib/api/multipartDelete';
import objectPutPart from '../../../lib/api/objectPutPart';
import { makeAuthInfo } from '../helpers';

const bucketName = 'multipartdeletebucket';
const log = new DummyRequestLogger();
const authInfo = makeAuthInfo('accessKey1');

const namespace = 'default';
const bucketPutRequest = {
    bucketName,
    namespace,
    headers: { host: `${bucketName}.s3.amazonaws.com` },
    url: '/',
    post: '',
};
const objectKey = 'testObject';
const initiateRequest = {
    bucketName,
    namespace,
    objectKey,
    headers: { host: `${bucketName}.s3.amazonaws.com` },
    url: `/${objectKey}?uploads`,
};
const originalUsEastBehavior = config.usEastBehavior;

function _createAndAbortMpu(usEastSetting, fakeUploadID, locationConstraint,
    callback) {
    config.usEastBehavior = usEastSetting;
    async.waterfall([
        next => bucketPut(authInfo, bucketPutRequest, locationConstraint, log,
            next),
        next =>
            initiateMultipartUpload(authInfo, initiateRequest, log, next),
        (result, next) => parseString(result, next),
        (json, next) => {
            // use uploadId parsed from initiateMpu request to construct
            // uploadPart and deleteMpu requests
            const uploadId =
                json.InitiateMultipartUploadResult.UploadId[0];
            const partBody = Buffer.from('I am a part\n', 'utf8');
            const partRequest = new DummyRequest({
                bucketName,
                namespace,
                objectKey,
                headers: { host: `${bucketName}.s3.amazonaws.com` },
                url: `/${objectKey}?partNumber=1&uploadId=${uploadId}`,
                query: {
                    partNumber: '1',
                    uploadId,
                },
            }, partBody);
            const testUploadId = fakeUploadID ? 'nonexistinguploadid' :
                uploadId;
            const deleteMpuRequest = {
                bucketName,
                namespace,
                objectKey,
                headers: { host: `${bucketName}.s3.amazonaws.com` },
                url: `/${objectKey}?uploadId=${testUploadId}`,
                query: { uploadId: testUploadId },
            };
            next(null, partRequest, deleteMpuRequest);
        },
        (partRequest, deleteMpuRequest, next) =>
            objectPutPart(authInfo, partRequest, undefined, log, err => {
                if (err) {
                    return next(err);
                }
                return next(null, deleteMpuRequest);
            }),
        (deleteMpuRequest, next) =>
            multipartDelete(authInfo, deleteMpuRequest, log, next),
    ], callback);
}

describe('Multipart Delete API', () => {
    beforeEach(() => {
        cleanup();
    });
    afterEach(() => {
        config.usEastBehavior = originalUsEastBehavior; // set back to original
        cleanup();
    });

    it('should not return error if mpu exists with uploadId and at least ' +
    'one part', done => {
        _createAndAbortMpu(true, false, 'us-east-1', err => {
            assert.strictEqual(err, null, `Expected no error, got ${err}`);
            done(err);
        });
    });

    it('should still not return error if uploadId does not exist on ' +
    'multipart abort call, in region other than us-east-1', done => {
        _createAndAbortMpu(true, true, 'us-west-1', err => {
            assert.strictEqual(err, undefined, `Expected no error, got ${err}`);
            done(err);
        });
    });

    it('bucket created in us-east-1: should return 404 if uploadId does not ' +
    'exist and usEastBehavior set to true',
    done => {
        _createAndAbortMpu(true, true, 'us-east-1', err => {
            assert.strictEqual(err, errors.NoSuchUpload,
                `Expected NoSuchUpload, got ${err}`);
            done();
        });
    });

    it('bucket created in us-east-1: should return no error if uploadId ' +
    'does not exist and usEastBehavior set to false', done => {
        _createAndAbortMpu(false, true, 'us-east-1', err => {
            assert.strictEqual(err, undefined, `Expected no error, got ${err}`);
            done();
        });
    });
});