const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      success: false,
      error: 'No token provided' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ 
      success: false,
      error: 'Invalid token' 
    });
  }
};

const verifyRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.position)) {
      return res.status(403).json({ 
        success: false,
        error: 'Insufficient permissions' 
      });
    }
    next();
  };
};

module.exports = { verifyToken, verifyRole };