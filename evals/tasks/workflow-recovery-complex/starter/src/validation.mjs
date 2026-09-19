export function validate(request) {
  if (!request || typeof request.directory !== 'string') throw Error('invalid request');
}
