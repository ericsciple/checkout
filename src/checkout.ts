Object.keys(process.env).sort().forEach(
    key => {
        console.log(`${key}=${process.env[key]}`);
    });