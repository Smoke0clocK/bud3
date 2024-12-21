const { ec: EC } = require('elliptic');
const ec = new EC('secp256k1');

// Replace this with the private key
const privateKey = '53c5b3e1853001a260868ec81d75dc43f580902946c5d0c5840063c46fded591';

// Derive the public key
const key = ec.keyFromPrivate(privateKey);
const publicKeyHex = key.getPublic(true, 'hex');
console.log('Derived Public Key:', publicKeyHex);
