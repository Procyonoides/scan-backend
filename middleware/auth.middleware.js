const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  console.log('🔐 Auth Middleware - Incoming request:', {
    method: req.method,
    path: req.path,
    hasAuthHeader: !!req.headers['authorization']
  });

  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    console.error('❌ No Authorization header found');
    return res.status(401).json({ 
      success: false,
      error: 'No token provided' 
    });
  }

  const token = authHeader.split(' ')[1];
  
  if (!token) {
    console.error('❌ Token not found in Authorization header');
    return res.status(401).json({ 
      success: false,
      error: 'Invalid token format' 
    });
  }

  console.log('🔑 Token received:', token.substring(0, 30) + '...');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token verified successfully:', {
      username: decoded.username,
      position: decoded.position
    });
    
    req.user = decoded;
    next();
  } catch (err) {
    console.error('❌ Token verification failed:', err.message);
    res.status(403).json({ 
      success: false,
      error: 'Invalid token',
      message: err.message
    });
  }
};

const verifyRole = (roles) => {
  return (req, res, next) => {
    console.log('🔒 Role verification:', {
      requiredRoles: roles,
      userPosition: req.user?.position
    });

    if (!roles.includes(req.user.position)) {
      console.error('❌ Insufficient permissions');
      return res.status(403).json({ 
        success: false,
        error: 'Insufficient permissions' 
      });
    }
    
    console.log('✅ Role verification passed');
    next();
  };
};

module.exports = { verifyToken, verifyRole };