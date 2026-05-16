const mentorValidationService = require('../services/mentor-validation.service');
const ApiResponse = require('../utils/ApiResponse');

const listMentorValidationRequests = async (req, res, next) => {
  try {
    const requests = await mentorValidationService.listMentorValidationRequests(
      req.user,
      req.query
    );
    res
      .status(200)
      .json(new ApiResponse(200, requests, 'Mentor validation requests fetched successfully'));
  } catch (error) {
    next(error);
  }
};

const getMentorValidationRequestById = async (req, res, next) => {
  try {
    const request = await mentorValidationService.getMentorValidationRequestById(
      req.user,
      req.params.requestId
    );
    res
      .status(200)
      .json(new ApiResponse(200, request, 'Validation request details fetched successfully'));
  } catch (error) {
    next(error);
  }
};

const acceptValidationRequest = async (req, res, next) => {
  try {
    const request = await mentorValidationService.acceptValidationRequest(
      req.user,
      req.params.requestId,
      req.body
    );
    res.status(200).json(new ApiResponse(200, request, 'Validation request accepted successfully'));
  } catch (error) {
    next(error);
  }
};

const rejectValidationRequest = async (req, res, next) => {
  try {
    const request = await mentorValidationService.rejectValidationRequest(
      req.user,
      req.params.requestId,
      req.body
    );
    res.status(200).json(new ApiResponse(200, request, 'Validation request rejected successfully'));
  } catch (error) {
    next(error);
  }
};

const listLearnerValidationRequests = async (req, res, next) => {
  try {
    const requests = await mentorValidationService.listLearnerValidationRequests(req.user);
    res
      .status(200)
      .json(new ApiResponse(200, requests, 'Learner validation requests fetched successfully'));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listMentorValidationRequests,
  getMentorValidationRequestById,
  acceptValidationRequest,
  rejectValidationRequest,
  listLearnerValidationRequests,
};
