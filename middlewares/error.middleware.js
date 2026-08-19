'use strict';

function errorHandler(err, _req, res, _next) {
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: Object.values(err.errors).map((item) => item.message).join(', '),
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Already exists',
    });
  }

  const statusCode = err.statusCode || 500;
  if (statusCode === 500) {
    console.error(err);
  }
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Something went wrong' : err.message,
  });
}

module.exports = errorHandler;
