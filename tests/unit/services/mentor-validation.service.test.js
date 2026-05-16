const Mentor = require('../../../src/models/Mentor');
const Notification = require('../../../src/models/Notification');
const Skill = require('../../../src/models/Skill');
const SkillEvidence = require('../../../src/models/SkillEvidence');
const User = require('../../../src/models/User');
const ValidationRequest = require('../../../src/models/ValidationRequest');
const mentorValidationService = require('../../../src/services/mentor-validation.service');

jest.mock('../../../src/models/ValidationRequest', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../../../src/models/Skill', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../../../src/models/User', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../../../src/models/SkillEvidence', () => ({
  find: jest.fn(),
}));

jest.mock('../../../src/models/Notification', () => ({
  create: jest.fn(),
}));

jest.mock('../../../src/models/Mentor', () => ({
  updateOne: jest.fn(),
}));

const mentorUser = { userId: 'USR-MENTOR', role: 'MENTOR' };
const learnerUser = { userId: 'USR-LEARNER', role: 'LEARNER' };

const pendingRequestDoc = {
  requestId: 'VAL-1',
  skillId: 'SKILL-1',
  learnerUserId: 'USR-LEARNER',
  mentorUserId: 'USR-MENTOR',
  requestStatus: 'PENDING',
  requestNote: 'Please review',
  validationScore: 0,
  validationFeedback: '',
  rejectionReason: '',
  submittedAt: new Date('2026-05-01'),
  save: jest.fn().mockResolvedValue(undefined),
};

const skillDoc = {
  skillId: 'SKILL-1',
  userId: 'USR-LEARNER',
  skillName: 'Node.js',
  validationStatus: 'PENDING',
  validationScore: 0,
  save: jest.fn().mockResolvedValue(undefined),
};

describe('mentor-validation.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Notification.create.mockResolvedValue({});
    Mentor.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it('rejects non-mentor users from listing requests', async () => {
    await expect(
      mentorValidationService.listMentorValidationRequests({ userId: 'USR-1', role: 'LEARNER' })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('accepts a pending request, validates skill, and adds offered skill', async () => {
    const learnerDoc = {
      userId: 'USR-LEARNER',
      accountStatus: 'ACTIVE',
      offeredSkills: [],
      save: jest.fn().mockResolvedValue(undefined),
    };

    ValidationRequest.findOne.mockResolvedValue(pendingRequestDoc);
    Skill.findOne.mockResolvedValue(skillDoc);
    User.findOne.mockResolvedValue(learnerDoc);
    SkillEvidence.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const result = await mentorValidationService.acceptValidationRequest(mentorUser, 'VAL-1', {
      validationScore: 85,
      validationFeedback: 'Strong portfolio',
    });

    expect(pendingRequestDoc.requestStatus).toBe('VALIDATED');
    expect(pendingRequestDoc.validationScore).toBe(85);
    expect(skillDoc.validationStatus).toBe('VALIDATED');
    expect(skillDoc.validationScore).toBe(85);
    expect(learnerDoc.offeredSkills).toEqual(['Node.js']);
    expect(learnerDoc.save).toHaveBeenCalled();
    expect(Notification.create).toHaveBeenCalled();
    expect(result.requestStatus).toBe('VALIDATED');
  });

  it('rejects a pending request and resets skill validation state', async () => {
    ValidationRequest.findOne.mockResolvedValue(pendingRequestDoc);
    Skill.findOne.mockResolvedValue(skillDoc);
    SkillEvidence.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const result = await mentorValidationService.rejectValidationRequest(mentorUser, 'VAL-1', {
      rejectionReason: 'Insufficient evidence',
    });

    expect(pendingRequestDoc.requestStatus).toBe('REJECTED');
    expect(pendingRequestDoc.rejectionReason).toBe('Insufficient evidence');
    expect(skillDoc.validationStatus).toBe('UNVALIDATED');
    expect(Notification.create).toHaveBeenCalled();
    expect(result.requestStatus).toBe('REJECTED');
  });

  it('prevents accepting an already closed request', async () => {
    ValidationRequest.findOne.mockResolvedValue({
      ...pendingRequestDoc,
      requestStatus: 'VALIDATED',
    });
    Skill.findOne.mockResolvedValue(skillDoc);
    SkillEvidence.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    await expect(
      mentorValidationService.acceptValidationRequest(mentorUser, 'VAL-1', {
        validationScore: 70,
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'VALIDATION_REQUEST_CLOSED' });
  });
});
