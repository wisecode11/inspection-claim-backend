'use strict';

function validateBody(parser) {
  return (req, _res, next) => {
    try {
      req.body = parser(req.body || {});
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { validateBody };
