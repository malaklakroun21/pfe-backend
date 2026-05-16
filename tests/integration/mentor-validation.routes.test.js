const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth.middleware', () => {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '').trim();

    if (token === 'mentor-token') {
      req.user = { userId: 'USR-MENTOR', role: 'MENTOR' };
      return next();
    }

    if (token === 'learner-token') {
      req.user = { userId: 'USR-LEARNER', role: 'LEARNER' };
      return next();
    }

    return next(new Error('Unauthorized test token'));
  };
});

jest.mock('../../src/models/ValidationRequest', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../../src/models/Skill', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../../src/models/User', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../../src/models/SkillEvidence', () => ({
  find: jest.fn(),
}));

jest.mock('../../src/models/Notification', () => ({
  create: jest.fn(),
}));

jest.mock('../../src/models/Mentor', () => ({
  updateOne: jest.fn(),
}));

const ValidationRequest = require('../../src/models/ValidationRequest');
const Skill = require('../../src/models/Skill');
const User = require('../../src/models/User');
const SkillEvidence = require('../../src/models/SkillEvidence');
const Notification = require('../../src/models/Notification');

const mentorValidationRoutes = require('../../src/routes/mentor-validation.routes');
const errorHandler = require('../../src/middleware/error.middleware');

describe('mentor validation routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', mentorValidationRoutes);
  app.use(errorHandler);

  const pendingRequest = {
    requestId: 'VAL-100',
    skillId: 'SKILL-100',
    learnerUserId: 'USR-LEARNER',
    mentorUserId: 'USR-MENTOR',
    requestStatus: 'PENDING',
    requestNote: 'Review my work',
    validationScore: 0,
    validationFeedback: '',
    rejectionReason: '',
    submittedAt: new Date('2026-05-01'),
    save: jest.fn().mockResolvedValue(undefined),
  };

  const skillDoc = {
    skillId: 'SKILL-100',
    userId: 'USR-LEARNER',
    skillName: 'React',
    validationStatus: 'PENDING',
    validationScore: 0,
    save: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Notification.create.mockResolvedValue({});
  });

  it('returns 403 when a learner tries to list mentor requests', async () => {
    const res = await request(app)
      .get('/api/v1/mentor/validation-requests')
      .set('Authorization', 'Bearer learner-token');

    expect(res.status).toBe(403);
  });

  it('lists open mentor validation requests', async () => {
    ValidationRequest.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([pendingRequest]),
      }),
    });
    Skill.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([skillDoc]) });
    User.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { userId: 'USR-LEARNER', firstName: 'Learner', lastName: 'One' },
      ]),
    });

    const res = await request(app)
      .get('/api/v1/mentor/validation-requests')
      .set('Authorization', 'Bearer mentor-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      requestId: 'VAL-100',
      skillName: 'React',
      requestStatus: 'PENDING',
    });
  });

  it('accepts a validation request with score', async () => {
    ValidationRequest.findOne.mockResolvedValue(pendingRequest);
    Skill.findOne.mockResolvedValue(skillDoc);
    SkillEvidence.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    User.findOne.mockResolvedValue({
      userId: 'USR-LEARNER',
      accountStatus: 'ACTIVE',
      offeredSkills: [],
      save: jest.fn().mockResolvedValue(undefined),
    });

    const res = await request(app)
      .patch('/api/v1/mentor/validation-requests/VAL-100/accept')
      .set('Authorization', 'Bearer mentor-token')
      .send({ validationScore: 90, validationFeedback: 'Excellent' });

    expect(res.status).toBe(200);
    expect(res.body.data.requestStatus).toBe('VALIDATED');
    expect(res.body.data.validationScore).toBe(90);
    expect(skillDoc.validationStatus).toBe('VALIDATED');
  });

  it('rejects a validation request', async () => {
    const openRequest = {
      ...pendingRequest,
      requestStatus: 'PENDING',
      save: jest.fn().mockResolvedValue(undefined),
    };

    ValidationRequest.findOne.mockResolvedValue(openRequest);
    Skill.findOne.mockResolvedValue({ ...skillDoc, save: jest.fn().mockResolvedValue(undefined) });
    SkillEvidence.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const res = await request(app)
      .patch('/api/v1/mentor/validation-requests/VAL-100/reject')
      .set('Authorization', 'Bearer mentor-token')
      .send({ rejectionReason: 'Need more evidence' });

    expect(res.status).toBe(200);
    expect(res.body.data.requestStatus).toBe('REJECTED');
  });
});
