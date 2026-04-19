export function emptyInputSchema() {
    return { type: 'object', properties: {}, required: [] };
}
export function normalizeInputSchema(schema) {
    return {
        type: 'object',
        properties: schema?.properties ?? {},
        required: schema?.required ?? [],
    };
}
export function createToolDefinition(init) {
    return {
        name: init.name,
        summary: init.summary,
        description: init.description || `${init.method.toUpperCase()} ${init.path}`,
        method: init.method.toUpperCase(),
        path: init.path,
        controller: init.controller,
        tags: init.tags,
        examples: init.examples,
        hidden: init.hidden,
        safe: init.safe,
        idempotent: init.idempotent,
        longRunning: init.longRunning,
        input_schema: normalizeInputSchema(init.input_schema),
        response_schema: init.response_schema,
    };
}
export function buildInputSchemaFromOpenAPIOperation(operation) {
    const properties = {};
    const required = new Set();
    if (Array.isArray(operation?.parameters)) {
        for (const param of operation.parameters) {
            if (!param?.name || !param?.schema)
                continue;
            properties[param.name] = { ...param.schema };
            if (param.description)
                properties[param.name].description = param.description;
            if (param.required)
                required.add(param.name);
        }
    }
    const bodySchema = operation?.requestBody?.content?.['application/json']?.schema;
    if (bodySchema?.type === 'object' && bodySchema.properties) {
        Object.assign(properties, bodySchema.properties);
        for (const name of bodySchema.required ?? [])
            required.add(name);
    }
    return {
        type: 'object',
        properties,
        required: Array.from(required),
    };
}
export function buildResponseSchemaFromOpenAPIOperation(operation) {
    const responses = operation?.responses;
    if (!responses || typeof responses !== 'object')
        return undefined;
    for (const status of ['200', '201', '202', 'default']) {
        const schema = responses[status]?.content?.['application/json']?.schema;
        if (schema)
            return schema;
    }
    for (const response of Object.values(responses)) {
        const schema = response?.content?.['application/json']?.schema;
        if (schema)
            return schema;
    }
    return undefined;
}
export function toolDefinitionFromOpenAPIOperation(path, method, operation) {
    if (!operation?.operationId)
        return null;
    return createToolDefinition({
        name: operation.operationId,
        summary: operation.summary,
        description: operation.description || operation.summary || `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        controller: operation.tags?.[0],
        tags: Array.isArray(operation.tags) ? operation.tags : undefined,
        input_schema: buildInputSchemaFromOpenAPIOperation(operation),
        response_schema: buildResponseSchemaFromOpenAPIOperation(operation),
    });
}
//# sourceMappingURL=tools.js.map