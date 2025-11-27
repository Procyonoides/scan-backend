const { body, validationResult, param } = require('express-validator');

/**
 * Middleware untuk handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }
  next();
};

/**
 * Validasi untuk Login
 */
const loginValidation = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  handleValidationErrors
];

/**
 * Validasi untuk Create User
 */
const createUserValidation = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and numbers'),
  body('email')
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format'),
  body('full_name')
    .trim()
    .notEmpty().withMessage('Full name is required')
    .isLength({ min: 3, max: 100 }).withMessage('Full name must be 3-100 characters'),
  body('role')
    .notEmpty().withMessage('Role is required')
    .isIn(['SERVER', 'IT', 'MANAGEMENT', 'RECEIVING', 'SHIPPING'])
    .withMessage('Invalid role'),
  handleValidationErrors
];

/**
 * Validasi untuk Update User
 */
const updateUserValidation = [
  param('id')
    .isInt().withMessage('Invalid user ID'),
  body('email')
    .optional()
    .isEmail().withMessage('Invalid email format'),
  body('full_name')
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 }).withMessage('Full name must be 3-100 characters'),
  body('role')
    .optional()
    .isIn(['SERVER', 'IT', 'MANAGEMENT', 'RECEIVING', 'SHIPPING'])
    .withMessage('Invalid role'),
  body('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE'])
    .withMessage('Invalid status'),
  handleValidationErrors
];

/**
 * Validasi untuk Scan Receiving
 */
const scanReceivingValidation = [
  body('original_barcode')
    .trim()
    .notEmpty().withMessage('Barcode is required'),
  body('warehouse_id')
    .isInt({ min: 1 }).withMessage('Valid warehouse ID is required'),
  body('quantity')
    .isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('model')
    .optional()
    .trim(),
  body('color')
    .optional()
    .trim(),
  body('size')
    .optional()
    .trim(),
  handleValidationErrors
];

/**
 * Validasi untuk Scan Shipping
 */
const scanShippingValidation = [
  body('original_barcode')
    .trim()
    .notEmpty().withMessage('Barcode is required'),
  body('warehouse_id')
    .isInt({ min: 1 }).withMessage('Valid warehouse ID is required'),
  body('quantity')
    .isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('model')
    .optional()
    .trim(),
  body('color')
    .optional()
    .trim(),
  body('size')
    .optional()
    .trim(),
  handleValidationErrors
];

/**
 * Validasi untuk Add Barcode
 */
const addBarcodeValidation = [
  body('original_barcode')
    .trim()
    .notEmpty().withMessage('Barcode is required')
    .isLength({ min: 5 }).withMessage('Barcode must be at least 5 characters'),
  body('brand')
    .trim()
    .notEmpty().withMessage('Brand is required'),
  body('model')
    .trim()
    .notEmpty().withMessage('Model is required'),
  body('color')
    .trim()
    .notEmpty().withMessage('Color is required'),
  body('size')
    .trim()
    .notEmpty().withMessage('Size is required'),
  handleValidationErrors
];

module.exports = {
  loginValidation,
  createUserValidation,
  updateUserValidation,
  scanReceivingValidation,
  scanShippingValidation,
  addBarcodeValidation,
  handleValidationErrors
};