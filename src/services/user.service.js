const { randomUUID } = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const City = require('../models/City');
const Country = require('../models/Country');
const Skill = require('../models/Skill');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { ALGERIA_CITY_NAMES } = require('../constants/algeria-cities');

const USER_ROLES = ['LEARNER', 'MENTOR', 'ADMIN'];
const RESUME_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'resumes');
const MAX_RESUME_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALGERIA_COUNTRY_CODE = 'DZ';
const ALGERIA_COUNTRY_NAME = 'Algeria';
const ALGERIA_COUNTRY_ID = 'COUNTRY-DZ';
const ALLOWED_RESUME_MIME_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
]);

const escapeRegExp = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const splitDisplayName = (name) => {
  const normalizedName = name.trim().replace(/\s+/g, ' ');
  const [firstName, ...rest] = normalizedName.split(' ');

  return {
    firstName,
    lastName: rest.join(' '),
  };
};

const buildResumeDownloadUrl = (storedName = '') => {
  return storedName ? `/uploads/resumes/${encodeURIComponent(storedName)}` : '';
};

const buildResumePublicFields = (userLike = {}) => {
  return {
    resumeFileName: userLike.resumeFileName || '',
    resumeMimeType: userLike.resumeMimeType || '',
    resumeUploadedAt: userLike.resumeUploadedAt || null,
    resumeDownloadUrl: buildResumeDownloadUrl(userLike.resumeStoredName),
  };
};

const sanitizeFileName = (fileName = '') => {
  return String(fileName)
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 255);
};

const buildCityIdFromName = (cityName = '') => {
  const normalizedKey = String(cityName)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `CITY-DZ-${normalizedKey}`;
};

const removeResumeFile = async (storedName = '') => {
  if (!storedName) {
    return;
  }

  try {
    await fs.unlink(path.join(RESUME_UPLOAD_DIR, storedName));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const ensureAlgeriaCountry = async () => {
  let country = await Country.findOne({
    $or: [
      { countryId: ALGERIA_COUNTRY_ID },
      { code: ALGERIA_COUNTRY_CODE },
      { name: new RegExp(`^${escapeRegExp(ALGERIA_COUNTRY_NAME)}$`, 'i') },
    ],
  });

  if (!country) {
    country = await Country.create({
      countryId: ALGERIA_COUNTRY_ID,
      code: ALGERIA_COUNTRY_CODE,
      name: ALGERIA_COUNTRY_NAME,
      phoneCode: '+213',
      currency: 'DZD',
      isActive: true,
    });
  } else if (!country.isActive) {
    country.isActive = true;
    await country.save();
  }

  return country;
};

const ensureAlgerianCities = async () => {
  const country = await ensureAlgeriaCountry();
  const existingCities = await City.find({ countryId: country.countryId }).lean();
  const existingCityNameMap = new Map(
    existingCities.map((city) => [city.name.trim().toLowerCase(), city])
  );
  const missingCities = ALGERIA_CITY_NAMES.filter((cityName) => {
    return !existingCityNameMap.has(cityName.toLowerCase());
  }).map((cityName) => ({
    cityId: buildCityIdFromName(cityName),
    countryId: country.countryId,
    name: cityName,
    isActive: true,
  }));

  if (missingCities.length > 0) {
    await City.insertMany(missingCities, { ordered: false });
  }

  return City.find({ countryId: country.countryId, isActive: true })
    .sort({ name: 1 })
    .lean();
};

const saveResumeFile = async ({ fileName = '', fileDataUrl = '' } = {}) => {
  const normalizedFileName = sanitizeFileName(fileName);
  const normalizedDataUrl = String(fileDataUrl || '').trim();
  const dataUrlMatch = normalizedDataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!normalizedFileName || !dataUrlMatch) {
    throw new ApiError(400, 'A valid resume file is required', 'VALIDATION_ERROR');
  }

  const mimeType = dataUrlMatch[1].trim().toLowerCase();
  const fileExtension = ALLOWED_RESUME_MIME_TYPES.get(mimeType);

  if (!fileExtension) {
    throw new ApiError(
      400,
      'Resume file must be a PDF, DOC, or DOCX document',
      'VALIDATION_ERROR'
    );
  }

  const fileBuffer = Buffer.from(dataUrlMatch[2], 'base64');

  if (!fileBuffer.length || fileBuffer.length > MAX_RESUME_FILE_SIZE_BYTES) {
    throw new ApiError(
      400,
      'Resume file must be smaller than 5 MB',
      'VALIDATION_ERROR'
    );
  }

  await fs.mkdir(RESUME_UPLOAD_DIR, { recursive: true });

  const storedName = `${randomUUID()}${fileExtension}`;
  await fs.writeFile(path.join(RESUME_UPLOAD_DIR, storedName), fileBuffer);

  return {
    resumeFileName: normalizedFileName,
    resumeStoredName: storedName,
    resumeMimeType: mimeType,
    resumeUploadedAt: new Date(),
  };
};

const sanitizeUser = (user) => {
  const plainUser = user.toObject ? user.toObject() : { ...user };
  const resumePublicFields = buildResumePublicFields(plainUser);
  delete plainUser.passwordHash;
  delete plainUser.resumeStoredName;

  return {
    ...plainUser,
    ...resumePublicFields,
  };
};

const sanitizePublicUser = (user) => {
  const plainUser = sanitizeUser(user);

  return {
    userId: plainUser.userId,
    firstName: plainUser.firstName,
    lastName: plainUser.lastName,
    profilePicture: plainUser.profilePicture,
    bio: plainUser.bio,
    portfolioUrl: plainUser.portfolioUrl || '',
    resumeFileName: plainUser.resumeFileName || '',
    resumeMimeType: plainUser.resumeMimeType || '',
    resumeUploadedAt: plainUser.resumeUploadedAt || null,
    resumeDownloadUrl: plainUser.resumeDownloadUrl || '',
    countryId: plainUser.countryId,
    cityId: plainUser.cityId,
    languages: plainUser.languages || [],
    offeredSkills: plainUser.offeredSkills || [],
    wantedSkills: plainUser.wantedSkills || [],
    role: plainUser.role,
    createdAt: plainUser.createdAt,
  };
};

const ensureAuthenticatedUser = (user) => {
  if (!user) {
    throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return user;
};

const normalizeUserId = (userId) => {
  const normalizedUserId = userId?.trim();

  if (!normalizedUserId) {
    throw new ApiError(400, 'User id is required', 'VALIDATION_ERROR');
  }

  return normalizedUserId;
};

const parsePositiveInteger = (value, fallback, fieldName, maxValue = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, `${fieldName} must be a positive integer`, 'VALIDATION_ERROR');
  }

  return Math.min(parsed, maxValue);
};

const extractSkillName = (payload = {}) => {
  const rawSkillName = payload.skillName ?? payload.skill;
  const normalizedSkillName = rawSkillName?.trim();

  if (!normalizedSkillName) {
    throw new ApiError(400, 'Skill name is required', 'VALIDATION_ERROR');
  }

  return normalizedSkillName;
};

const assertLearnerCanOfferSkill = async (userId, skillName) => {
  const validatedSkill = await Skill.findOne({
    userId,
    skillName: new RegExp(`^${escapeRegExp(skillName)}$`, 'i'),
    validationStatus: 'VALIDATED',
  });

  if (!validatedSkill) {
    throw new ApiError(
      403,
      'Only mentor-validated skills can be added to your teach list',
      'SKILL_NOT_VALIDATED'
    );
  }
};

const hasSkill = (skills = [], targetSkillName) => {
  const normalizedTarget = targetSkillName.toLowerCase();

  return skills.some((skill) => skill.toLowerCase() === normalizedTarget);
};

const getCurrentUser = (user) => {
  return sanitizeUser(ensureAuthenticatedUser(user));
};

const getCurrentUserSkillList = (user, fieldName) => {
  const currentUser = ensureAuthenticatedUser(user);

  return [...(currentUser[fieldName] || [])];
};

const getCurrentUserOfferedSkills = (user) => {
  return {
    offeredSkills: getCurrentUserSkillList(user, 'offeredSkills'),
  };
};

const getCurrentUserWantedSkills = (user) => {
  return {
    wantedSkills: getCurrentUserSkillList(user, 'wantedSkills'),
  };
};

const applyProfileUpdates = (currentUser, payload = {}) => {
  if (payload.name !== undefined) {
    const { firstName, lastName } = splitDisplayName(payload.name);
    currentUser.firstName = firstName;
    currentUser.lastName = lastName;
  }

  if (payload.firstName !== undefined) {
    currentUser.firstName = payload.firstName;
  }

  if (payload.lastName !== undefined) {
    currentUser.lastName = payload.lastName;
  }

  if (payload.bio !== undefined) {
    currentUser.bio = payload.bio;
  }

  if (payload.portfolioUrl !== undefined) {
    currentUser.portfolioUrl = payload.portfolioUrl.trim();
  }

  if (payload.email !== undefined) {
    currentUser.email = payload.email.trim().toLowerCase();
  }

  if (payload.languages !== undefined) {
    const normalizedLanguages = Array.isArray(payload.languages)
      ? payload.languages
      : String(payload.languages)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    currentUser.languages = normalizedLanguages;
  }

  if (payload.avatar !== undefined) {
    currentUser.profilePicture = payload.avatar;
  }

  if (payload.photo !== undefined) {
    currentUser.profilePicture = payload.photo;
  }

  if (payload.profilePicture !== undefined) {
    currentUser.profilePicture = payload.profilePicture;
  }
};

const applyLocationUpdates = async (currentUser, payload = {}) => {
  if (payload.cityId === undefined) {
    return;
  }

  const normalizedCityId = payload.cityId.trim();

  if (!normalizedCityId) {
    currentUser.cityId = '';
    currentUser.countryId = '';
    return;
  }

  const city = await City.findOne({
    cityId: normalizedCityId,
    isActive: true,
  });

  if (!city) {
    throw new ApiError(400, 'Selected city is invalid', 'VALIDATION_ERROR');
  }

  const country = await Country.findOne({
    countryId: city.countryId,
    isActive: true,
  });

  if (!country || country.code !== ALGERIA_COUNTRY_CODE) {
    throw new ApiError(
      400,
      'Only Algerian cities are available in this field',
      'VALIDATION_ERROR'
    );
  }

  currentUser.cityId = city.cityId;
  currentUser.countryId = city.countryId;
};

const applyResumeUpdates = async (currentUser, payload = {}) => {
  const shouldRemoveResume = Boolean(payload.removeResume);
  const normalizedResumeFileName = payload.resumeFileName?.trim() || '';
  const normalizedResumeDataUrl = payload.resumeFileDataUrl?.trim() || '';
  const hasNewResumeUpload = Boolean(normalizedResumeFileName && normalizedResumeDataUrl);
  const hasPartialResumeUpload = Boolean(normalizedResumeFileName || normalizedResumeDataUrl);

  if (hasPartialResumeUpload && !hasNewResumeUpload) {
    throw new ApiError(400, 'Resume file data is incomplete', 'VALIDATION_ERROR');
  }

  if (!shouldRemoveResume && !hasNewResumeUpload) {
    return;
  }

  const previousStoredName = currentUser.resumeStoredName || '';

  if (hasNewResumeUpload) {
    const uploadedResume = await saveResumeFile({
      fileName: normalizedResumeFileName,
      fileDataUrl: normalizedResumeDataUrl,
    });

    currentUser.resumeFileName = uploadedResume.resumeFileName;
    currentUser.resumeStoredName = uploadedResume.resumeStoredName;
    currentUser.resumeMimeType = uploadedResume.resumeMimeType;
    currentUser.resumeUploadedAt = uploadedResume.resumeUploadedAt;

    if (previousStoredName) {
      await removeResumeFile(previousStoredName);
    }

    return;
  }

  if (shouldRemoveResume) {
    currentUser.resumeFileName = '';
    currentUser.resumeStoredName = '';
    currentUser.resumeMimeType = '';
    currentUser.resumeUploadedAt = undefined;

    if (previousStoredName) {
      await removeResumeFile(previousStoredName);
    }
  }
};

const updateCurrentUser = async (user, payload) => {
  const currentUser = ensureAuthenticatedUser(user);
  applyProfileUpdates(currentUser, payload);
  await applyLocationUpdates(currentUser, payload);
  await applyResumeUpdates(currentUser, payload);

  await currentUser.save();

  return sanitizeUser(currentUser);
};

const getUserDocumentById = async (userId, options = {}) => {
  const normalizedUserId = normalizeUserId(userId);
  const filter = {
    userId: normalizedUserId,
  };

  if (options.activeOnly) {
    filter.accountStatus = 'ACTIVE';
  }

  const user = await User.findOne(filter);

  if (!user) {
    throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  }

  return user;
};

const getUserPublicProfile = async (userId) => {
  const user = await getUserDocumentById(userId, { activeOnly: true });

  return sanitizePublicUser(user);
};

const getUserById = async (id) => {
  return getUserPublicProfile(id);
};

const updateUserProfile = async (userId, updates = {}) => {
  const currentUser = await getUserDocumentById(userId, { activeOnly: true });

  if (updates.email !== undefined) {
    const normalizedEmail = updates.email.trim().toLowerCase();
    const existingUser = await User.findOne({
      email: normalizedEmail,
      userId: { $ne: currentUser.userId },
    });

    if (existingUser) {
      throw new ApiError(409, 'Email already in use', 'EMAIL_ALREADY_EXISTS');
    }
  }

  applyProfileUpdates(currentUser, updates);
  await applyLocationUpdates(currentUser, updates);
  await applyResumeUpdates(currentUser, updates);
  await currentUser.save();

  return sanitizeUser(currentUser);
};

const listAlgerianCities = async () => {
  const country = await ensureAlgeriaCountry();
  const cities = await ensureAlgerianCities();

  return {
    country: {
      id: country.countryId,
      code: country.code,
      name: country.name,
    },
    cities: cities.map((city) => ({
      id: city.cityId,
      label: city.name,
    })),
  };
};

const listUsers = async (query = {}) => {
  const q = query.q?.trim();
  const role = query.role?.trim().toUpperCase();
  const offeredSkill = query.offeredSkill?.trim();
  const wantedSkill = query.wantedSkill?.trim();
  const skill = query.skill?.trim();
  const page = parsePositiveInteger(query.page, 1, 'page');
  const limit = parsePositiveInteger(query.limit, 20, 'limit', 100);

  const filters = [
    {
      accountStatus: 'ACTIVE',
    },
  ];

  if (role) {
    if (!USER_ROLES.includes(role)) {
      throw new ApiError(400, 'Invalid role filter', 'VALIDATION_ERROR');
    }

    filters.push({ role });
  }

  if (q) {
    const escapedQuery = escapeRegExp(q);
    const searchRegex = new RegExp(escapedQuery, 'i');

    filters.push({
      $or: [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { userId: searchRegex },
        { offeredSkills: searchRegex },
        { wantedSkills: searchRegex },
      ],
    });
  }

  if (offeredSkill) {
    filters.push({
      offeredSkills: new RegExp(`^${escapeRegExp(offeredSkill)}$`, 'i'),
    });
  }

  if (wantedSkill) {
    filters.push({
      wantedSkills: new RegExp(`^${escapeRegExp(wantedSkill)}$`, 'i'),
    });
  }

  if (skill) {
    const exactSkillRegex = new RegExp(`^${escapeRegExp(skill)}$`, 'i');

    filters.push({
      $or: [
        { offeredSkills: exactSkillRegex },
        { wantedSkills: exactSkillRegex },
      ],
    });
  }

  const filter = filters.length === 1 ? filters[0] : { $and: filters };

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return {
    items: items.map(sanitizePublicUser),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

const searchUsers = async ({ skill, role, page, limit, q, offeredSkill, wantedSkill } = {}) => {
  return listUsers({
    skill,
    role,
    page,
    limit,
    q,
    offeredSkill,
    wantedSkill,
  });
};

const addSkillToCurrentUser = async (user, fieldName, payload) => {
  const currentUser = ensureAuthenticatedUser(user);
  const skillName = extractSkillName(payload);
  const currentSkills = currentUser[fieldName] || [];

  if (fieldName === 'offeredSkills' && String(currentUser.role || '').toUpperCase() === 'LEARNER') {
    await assertLearnerCanOfferSkill(currentUser.userId, skillName);
  }

  if (hasSkill(currentSkills, skillName)) {
    throw new ApiError(409, 'Skill already exists', 'SKILL_ALREADY_EXISTS');
  }

  currentUser[fieldName] = [...currentSkills, skillName];
  await currentUser.save();

  return sanitizeUser(currentUser);
};

const removeSkillFromCurrentUser = async (user, fieldName, payload) => {
  const currentUser = ensureAuthenticatedUser(user);
  const skillName = extractSkillName(payload);
  const currentSkills = currentUser[fieldName] || [];
  const skillIndex = currentSkills.findIndex((skill) => {
    return skill.toLowerCase() === skillName.toLowerCase();
  });

  if (skillIndex === -1) {
    throw new ApiError(404, 'Skill not found on profile', 'SKILL_NOT_FOUND');
  }

  currentSkills.splice(skillIndex, 1);
  currentUser[fieldName] = currentSkills;
  await currentUser.save();

  return sanitizeUser(currentUser);
};

const addOfferedSkillToCurrentUser = async (user, payload) => {
  return addSkillToCurrentUser(user, 'offeredSkills', payload);
};

const removeOfferedSkillFromCurrentUser = async (user, payload) => {
  return removeSkillFromCurrentUser(user, 'offeredSkills', payload);
};

const addWantedSkillToCurrentUser = async (user, payload) => {
  return addSkillToCurrentUser(user, 'wantedSkills', payload);
};

const removeWantedSkillFromCurrentUser = async (user, payload) => {
  return removeSkillFromCurrentUser(user, 'wantedSkills', payload);
};

const addSkillOffered = async (userId, payload) => {
  const user = await getUserDocumentById(userId, { activeOnly: true });
  return addOfferedSkillToCurrentUser(user, payload);
};

const removeSkillOffered = async (userId, payload) => {
  const user = await getUserDocumentById(userId, { activeOnly: true });
  return removeOfferedSkillFromCurrentUser(user, payload);
};

const addSkillWanted = async (userId, payload) => {
  const user = await getUserDocumentById(userId, { activeOnly: true });
  return addWantedSkillToCurrentUser(user, payload);
};

const removeSkillWanted = async (userId, payload) => {
  const user = await getUserDocumentById(userId, { activeOnly: true });
  return removeWantedSkillFromCurrentUser(user, payload);
};

module.exports = {
  sanitizeUser,
  sanitizePublicUser,
  getCurrentUser,
  getCurrentUserOfferedSkills,
  getCurrentUserWantedSkills,
  updateCurrentUser,
  getUserPublicProfile,
  getUserById,
  updateUserProfile,
  listAlgerianCities,
  listUsers,
  searchUsers,
  addOfferedSkillToCurrentUser,
  removeOfferedSkillFromCurrentUser,
  addWantedSkillToCurrentUser,
  removeWantedSkillFromCurrentUser,
  addSkillOffered,
  removeSkillOffered,
  addSkillWanted,
  removeSkillWanted,
};
