const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const env = require('./env');

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Lost & Found API',
      version: '1.0.0',
      description: 'REST API for the Lost & Found mobile app.',
    },
    servers: [{ url: `${env.appUrl}/api/v1`, description: env.nodeEnv }],
    // Order of sections in the Swagger page.
    tags: [{ name: 'System' }, { name: 'Auth' }, { name: 'Profile' }, { name: 'Categories' }, { name: 'Items' }, { name: 'Claims' }, { name: 'Chat' }, { name: 'Notifications' }, { name: 'Reports' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Something went wrong' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [path.resolve(__dirname, '..', 'routes', 'api', '*.js')],
});

function setupSwagger(app) {
  if (!env.swaggerEnabled) return;
  app.get('/api-docs.json', (req, res) => res.json(spec));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'Lost & Found API' }));
}

module.exports = { setupSwagger, spec };
