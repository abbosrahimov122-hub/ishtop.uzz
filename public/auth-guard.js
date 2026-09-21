fetch('https://script.google.com/macros/s/AKfycbysU3ixhEyoUJ5v_Na8rhD-1bveLesQFuNAqTZ64FWti0lyPpLzILuth9Pj7VVyJ6LF/exec', {
    method: 'POST',
    mode: 'no-cors', // Shu yerini qo'shing
    body: JSON.stringify(data)
});