var tc = require('@actions/tool-cache')

// function foo() { 
//     return new Promise((resolve, reject) => {
//         setTimeout(
//             () => {
//                 // reject('bad')
//                 reject(new Error('bad'))
//                 // resolve('asdf')
//             },
//             1)
//     })
// }

// foo()
//     .then((result) => {
//         console.log('the result is ' + result)
//     })
//     .catch((err) =>  {
//         console.log('the error is ' + (err.message || err))
//     })

tc.downloadTool('https://httpbin.org/stream/3', '/Users/eric/temp/node-test/download-file')
    .then(() => { console.log('successful download') })
    .catch((err) => console.log('caught error: ' + err.message))
