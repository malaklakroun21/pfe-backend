const express = require('express');

const mentorValidationController = require('../controllers/mentor-validation.controller');
const protect = require('../middleware/auth.middleware');
const restrictTo = require('../middleware/role.middleware');
const validate = require('../middleware/validate.middleware');
const {
  acceptValidationRequestSchema,
  rejectValidationRequestSchema,
} = require('../validators/mentor-validation.validator');

const router = express.Router();

router.use(protect);

router.get(
  '/mentor/validation-requests',
  restrictTo('MENTOR'),
  mentorValidationController.listMentorValidationRequests
);

router.get(
  '/mentor/validation-requests/:requestId',
  restrictTo('MENTOR'),
  mentorValidationController.getMentorValidationRequestById
);

router.patch(
  '/mentor/validation-requests/:requestId/accept',
  restrictTo('MENTOR'),
  validate(acceptValidationRequestSchema),
  mentorValidationController.acceptValidationRequest
);

router.patch(
  '/mentor/validation-requests/:requestId/reject',
  restrictTo('MENTOR'),
  validate(rejectValidationRequestSchema),
  mentorValidationController.rejectValidationRequest
);

router.get(
  '/validation-requests',
  mentorValidationController.listLearnerValidationRequests
);

module.exports = router;
