const { randomUUID } = require('crypto');

const ApiError = require('../utils/ApiError');
const Mentor = require('../models/Mentor');
const Notification = require('../models/Notification');
const Skill = require('../models/Skill');
const SkillEvidence = require('../models/SkillEvidence');
const User = require('../models/User');
const ValidationRequest = require('../models/ValidationRequest');

const OPEN_STATUSES = ['PENDING', 'IN_REVIEW'];
const TERMINAL_STATUSES = ['VALIDATED', 'REJECTED'];

const ensureAuthenticatedUser = (user) => {
  if (!user?.userId) {
    throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return user;
};

const ensureMentorUser = (user) => {
  const currentUser = ensureAuthenticatedUser(user);

  if (String(currentUser.role || '').toUpperCase() !== 'MENTOR') {
    throw new ApiError(403, 'Only mentors can manage validation requests', 'FORBIDDEN');
  }

  return currentUser;
};

const buildFullName = (user) => {
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return fullName || user?.email || 'Unknown user';
};

const hasSkillName = (skills = [], skillName = '') => {
  const normalized = skillName.trim().toLowerCase();
  return skills.some((skill) => String(skill).trim().toLowerCase() === normalized);
};

const addSkillToOfferedList = async (learnerUserId, skillName) => {
  const learner = await User.findOne({ userId: learnerUserId, accountStatus: 'ACTIVE' });

  if (!learner) {
    throw new ApiError(404, 'Learner not found', 'USER_NOT_FOUND');
  }

  const offeredSkills = learner.offeredSkills || [];

  if (!hasSkillName(offeredSkills, skillName)) {
    learner.offeredSkills = [...offeredSkills, skillName.trim()];
    await learner.save();
  }

  return learner;
};

const formatRequestSummary = (request, skill, learner) => {
  return {
    requestId: request.requestId,
    skillId: request.skillId,
    skillName: skill?.skillName || '',
    learnerUserId: request.learnerUserId,
    learnerName: learner ? buildFullName(learner) : '',
    mentorUserId: request.mentorUserId,
    requestStatus: request.requestStatus,
    requestNote: request.requestNote || '',
    validationScore: request.validationScore || 0,
    validationFeedback: request.validationFeedback || '',
    rejectionReason: request.rejectionReason || '',
    submittedAt: request.submittedAt,
    respondedAt: request.respondedAt || null,
  };
};

const loadRequestContext = async (mentorUserId, requestId) => {
  const request = await ValidationRequest.findOne({
    requestId: requestId.trim(),
    mentorUserId,
  });

  if (!request) {
    throw new ApiError(404, 'Validation request not found', 'VALIDATION_REQUEST_NOT_FOUND');
  }

  const [skill, learner, evidence] = await Promise.all([
    Skill.findOne({ skillId: request.skillId, userId: request.learnerUserId }),
    User.findOne({ userId: request.learnerUserId, accountStatus: 'ACTIVE' }).lean(),
    SkillEvidence.find({ skillId: request.skillId }).lean(),
  ]);

  return { request, skill, learner, evidence };
};

const listMentorValidationRequests = async (currentUser, query = {}) => {
  const mentor = ensureMentorUser(currentUser);
  const statusFilter = query.status?.trim().toUpperCase();

  const filter = { mentorUserId: mentor.userId };

  if (statusFilter) {
    if (statusFilter === 'OPEN') {
      filter.requestStatus = { $in: OPEN_STATUSES };
    } else {
      filter.requestStatus = statusFilter;
    }
  } else {
    filter.requestStatus = { $in: OPEN_STATUSES };
  }

  const requests = await ValidationRequest.find(filter).sort({ submittedAt: -1 }).lean();

  if (!requests.length) {
    return [];
  }

  const skillIds = [...new Set(requests.map((request) => request.skillId))];
  const learnerIds = [...new Set(requests.map((request) => request.learnerUserId))];

  const [skills, learners] = await Promise.all([
    Skill.find({ skillId: { $in: skillIds } }).lean(),
    User.find({ userId: { $in: learnerIds } }).lean(),
  ]);

  const skillMap = new Map(skills.map((skill) => [skill.skillId, skill]));
  const learnerMap = new Map(learners.map((learner) => [learner.userId, learner]));

  return requests.map((request) =>
    formatRequestSummary(request, skillMap.get(request.skillId), learnerMap.get(request.learnerUserId))
  );
};

const getMentorValidationRequestById = async (currentUser, requestId) => {
  const mentor = ensureMentorUser(currentUser);
  const { request, skill, learner, evidence } = await loadRequestContext(mentor.userId, requestId);

  return {
    ...formatRequestSummary(request, skill, learner),
    learner: learner
      ? {
          userId: learner.userId,
          fullName: buildFullName(learner),
          email: learner.email,
        }
      : null,
    skill: skill
      ? {
          skillId: skill.skillId,
          skillName: skill.skillName,
          proficiencyLevel: skill.proficiencyLevel,
          validationStatus: skill.validationStatus,
          validationScore: skill.validationScore || 0,
          description: skill.description || '',
        }
      : null,
    evidence: evidence.map((item) => ({
      evidenceId: item.evidenceId,
      evidenceType: item.evidenceType,
      evidenceUrl: item.evidenceUrl,
      title: item.title,
      description: item.description || '',
    })),
  };
};

const acceptValidationRequest = async (currentUser, requestId, payload = {}) => {
  const mentor = ensureMentorUser(currentUser);
  const { request, skill } = await loadRequestContext(mentor.userId, requestId);

  if (!OPEN_STATUSES.includes(request.requestStatus)) {
    throw new ApiError(
      409,
      `Cannot accept a request with status ${request.requestStatus}`,
      'VALIDATION_REQUEST_CLOSED'
    );
  }

  if (!skill) {
    throw new ApiError(404, 'Skill linked to this request was not found', 'SKILL_NOT_FOUND');
  }

  const validationScore = Number(payload.validationScore);
  const validationFeedback = payload.validationFeedback?.trim() || '';
  const respondedAt = new Date();

  request.requestStatus = 'VALIDATED';
  request.validationScore = validationScore;
  request.validationFeedback = validationFeedback;
  request.rejectionReason = '';
  request.respondedAt = respondedAt;
  await request.save();

  skill.validationStatus = 'VALIDATED';
  skill.validationScore = validationScore;
  skill.validatedBy = mentor.userId;
  skill.validatedAt = respondedAt;
  skill.lastUpdated = respondedAt;
  await skill.save();

  await addSkillToOfferedList(request.learnerUserId, skill.skillName);

  await Mentor.updateOne(
    { userId: mentor.userId },
    { $inc: { totalValidationsPerformed: 1 } },
    { upsert: false }
  );

  await Notification.create({
    notificationId: `NOTIF-${randomUUID()}`,
    userId: request.learnerUserId,
    notificationType: 'SYSTEM',
    title: 'Skill validated',
    description: `Your ${skill.skillName} skill was validated with a score of ${validationScore}. You can now teach this skill.`,
    relatedEntityId: request.requestId,
  });

  return formatRequestSummary(request, skill, null);
};

const rejectValidationRequest = async (currentUser, requestId, payload = {}) => {
  const mentor = ensureMentorUser(currentUser);
  const { request, skill } = await loadRequestContext(mentor.userId, requestId);

  if (!OPEN_STATUSES.includes(request.requestStatus)) {
    throw new ApiError(
      409,
      `Cannot reject a request with status ${request.requestStatus}`,
      'VALIDATION_REQUEST_CLOSED'
    );
  }

  const rejectionReason = payload.rejectionReason?.trim() || '';
  const respondedAt = new Date();

  request.requestStatus = 'REJECTED';
  request.validationScore = 0;
  request.validationFeedback = '';
  request.rejectionReason = rejectionReason;
  request.respondedAt = respondedAt;
  await request.save();

  if (skill) {
    skill.validationStatus = 'UNVALIDATED';
    skill.validationScore = 0;
    skill.validatedBy = '';
    skill.validatedAt = null;
    skill.lastUpdated = respondedAt;
    await skill.save();
  }

  await Notification.create({
    notificationId: `NOTIF-${randomUUID()}`,
    userId: request.learnerUserId,
    notificationType: 'SYSTEM',
    title: 'Validation request declined',
    description: rejectionReason
      ? `Your validation request was declined: ${rejectionReason}`
      : 'Your validation request was declined by the mentor.',
    relatedEntityId: request.requestId,
  });

  return formatRequestSummary(request, skill, null);
};

const listLearnerValidationRequests = async (currentUser) => {
  const user = ensureAuthenticatedUser(currentUser);

  const requests = await ValidationRequest.find({ learnerUserId: user.userId })
    .sort({ submittedAt: -1 })
    .lean();

  if (!requests.length) {
    return [];
  }

  const skillIds = [...new Set(requests.map((request) => request.skillId))];
  const mentorIds = [...new Set(requests.map((request) => request.mentorUserId))];

  const [skills, mentors] = await Promise.all([
    Skill.find({ skillId: { $in: skillIds } }).lean(),
    User.find({ userId: { $in: mentorIds } }).lean(),
  ]);

  const skillMap = new Map(skills.map((skill) => [skill.skillId, skill]));
  const mentorMap = new Map(mentors.map((mentor) => [mentor.userId, mentor]));

  const learnerProfile = await User.findOne({ userId: user.userId }).lean();

  return requests.map((request) => {
    const skill = skillMap.get(request.skillId);

    return {
      ...formatRequestSummary(request, skill, null),
      mentorName: mentorMap.get(request.mentorUserId)
        ? buildFullName(mentorMap.get(request.mentorUserId))
        : '',
      canTeach:
        request.requestStatus === 'VALIDATED' &&
        skill?.validationStatus === 'VALIDATED' &&
        hasSkillName(learnerProfile?.offeredSkills, skill?.skillName),
    };
  });
};

module.exports = {
  OPEN_STATUSES,
  TERMINAL_STATUSES,
  listMentorValidationRequests,
  getMentorValidationRequestById,
  acceptValidationRequest,
  rejectValidationRequest,
  listLearnerValidationRequests,
};
