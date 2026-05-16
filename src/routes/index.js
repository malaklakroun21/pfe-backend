const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const creditRoutes = require('./credit.routes');
const dashboardRoutes = require('./dashboard.routes');
const mentorValidationRoutes = require('./mentor-validation.routes');
const messageRoutes = require('./message.routes');
const notificationRoutes = require('./notification.routes');
const projectRoutes = require('./project.routes');
const ratingRoutes = require('./rating.routes');
const sessionRoutes = require('./session.routes');
const userRoutes = require('./user.routes');

router.use('/auth', authRoutes);
router.use('/credits', creditRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/', mentorValidationRoutes);
router.use('/messages', messageRoutes);
router.use('/notifications', notificationRoutes);
router.use('/projects', projectRoutes);
// New feature modules.
router.use('/ratings', ratingRoutes);
router.use('/sessions', sessionRoutes);
router.use('/users', userRoutes);

router.get('/', (req, res) => {
  res.json({ success: true, message: 'API v1 is running' });
});

module.exports = router;
