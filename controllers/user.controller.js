'use strict';

const asyncHandler = require('../utils/asyncHandler');
const userService = require('../services/user.service');

const userController = {
  createInspector: asyncHandler(async (req, res) => {
    const inspector = await userService.createInspector(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Inspector created',
      data: { inspector },
    });
  }),
};

module.exports = userController;
