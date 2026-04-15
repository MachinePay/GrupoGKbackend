const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const bcrypt = require("bcryptjs");

function normalizeContaBancariaIds(contaBancariaIds, contaBancariaId) {
  const rawIds = Array.isArray(contaBancariaIds)
    ? contaBancariaIds
    : contaBancariaIds === undefined
      ? contaBancariaId !== undefined && contaBancariaId !== null
        ? [contaBancariaId]
        : []
      : [contaBancariaIds];

  return [
    ...new Set(
      rawIds
        .filter(
          (value) => value !== undefined && value !== null && value !== "",
        )
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ];
}

async function ensureContasExistem(contaBancariaIds) {
  if (!contaBancariaIds.length) {
    return [];
  }

  const contas = await prisma.contaBancaria.findMany({
    where: { id: { in: contaBancariaIds } },
    select: { id: true, banco: true, nome: true },
  });

  if (contas.length !== contaBancariaIds.length) {
    throw new AppError(
      "Uma ou mais contas bancárias não foram encontradas.",
      404,
    );
  }

  return contas;
}

function mapUsuarioResponse(usuario) {
  const contasBancarias = usuario.contasAcesso?.length
    ? usuario.contasAcesso.map((item) => item.contaBancaria)
    : usuario.contaBancaria
      ? [usuario.contaBancaria]
      : [];
  const contaBancariaIds = contasBancarias.map((item) => item.id);
  const contaPrimaria =
    contasBancarias.find((item) => item.id === usuario.contaBancariaId) ||
    contasBancarias[0] ||
    usuario.contaBancaria ||
    null;

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    ativo: usuario.ativo,
    contaBancariaId: contaPrimaria?.id || usuario.contaBancariaId || null,
    contaBancaria: contaPrimaria,
    contaBancariaIds,
    contasBancarias,
    ultimoLoginAt: usuario.ultimoLoginAt,
    createdAt: usuario.createdAt,
  };
}

/**
 * Lista usuários com filtros opcionais.
 * @param {object} filters Filtros opcionais.
 * @returns {Promise<Array>}
 */
async function listarUsuarios(filters = {}) {
  const where = {
    ...(filters.perfil ? { perfil: filters.perfil } : {}),
    ...(filters.contaBancariaId
      ? {
          OR: [
            { contaBancariaId: Number(filters.contaBancariaId) },
            {
              contasAcesso: {
                some: { contaBancariaId: Number(filters.contaBancariaId) },
              },
            },
          ],
        }
      : {}),
  };

  const usuarios = await prisma.usuario.findMany({
    where,
    include: {
      contaBancaria: {
        select: { id: true, banco: true, nome: true },
      },
      contasAcesso: {
        include: {
          contaBancaria: {
            select: { id: true, banco: true, nome: true },
          },
        },
        orderBy: { contaBancariaId: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return usuarios.map(mapUsuarioResponse);
}

/**
 * Cria novo usuário com validações de acesso.
 * @param {object} payload Dados do usuário.
 * @param {string} payload.nome Nome do usuário.
 * @param {string} payload.email Email único.
 * @param {string} payload.senha Senha temporária.
 * @param {string} payload.perfil ADMIN | FINANCEIRO | CAIXA.
 * @param {number|null} payload.contaBancariaId Conta principal legada (opcional).
 * @param {number[]|null} payload.contaBancariaIds Contas autorizadas para CAIXA.
 * @returns {Promise<object>}
 */
async function criarUsuario(payload) {
  const { nome, email, senha, perfil, contaBancariaId, contaBancariaIds } =
    payload;
  const contasIds = normalizeContaBancariaIds(
    contaBancariaIds,
    contaBancariaId,
  );

  if (!nome || !email || !senha || !perfil) {
    throw new AppError("Nome, email, senha e perfil são obrigatórios.", 400);
  }

  const perfilValido = ["ADMIN", "FINANCEIRO", "CAIXA"].includes(perfil);
  if (!perfilValido) {
    throw new AppError("Perfil inválido. Use ADMIN, FINANCEIRO ou CAIXA.", 400);
  }

  if (perfil === "CAIXA" && !contasIds.length) {
    throw new AppError(
      "Usuários com perfil CAIXA exigem ao menos uma conta bancária.",
      400,
    );
  }

  if (perfil !== "CAIXA" && contasIds.length) {
    throw new AppError("Apenas usuários CAIXA podem ter conta restrita.", 400);
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    throw new AppError("Usuário com este email já existe.", 409);
  }

  await ensureContasExistem(contasIds);

  const senhaHash = await bcrypt.hash(senha, 10);

  const usuario = await prisma.usuario.create({
    data: {
      nome,
      email,
      senhaHash,
      perfil,
      contaBancariaId: perfil === "CAIXA" ? contasIds[0] || null : null,
      contasAcesso: contasIds.length
        ? {
            create: contasIds.map((id) => ({
              contaBancaria: { connect: { id } },
            })),
          }
        : undefined,
    },
    include: {
      contaBancaria: {
        select: { id: true, banco: true, nome: true },
      },
      contasAcesso: {
        include: {
          contaBancaria: {
            select: { id: true, banco: true, nome: true },
          },
        },
      },
    },
  });

  return mapUsuarioResponse(usuario);
}

/**
 * Atualiza dados de um usuário.
 * @param {number} usuarioId ID do usuário.
 * @param {object} payload Dados a atualizar.
 * @returns {Promise<object>}
 */
async function atualizarUsuario(usuarioId, payload) {
  const { nome, perfil, ativo, contaBancariaId, contaBancariaIds, senha } =
    payload;
  const contasIds = normalizeContaBancariaIds(
    contaBancariaIds,
    contaBancariaId,
  );

  const usuario = await prisma.usuario.findUnique({
    where: { id: Number(usuarioId) },
  });

  if (!usuario) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  if (perfil && !["ADMIN", "FINANCEIRO", "CAIXA"].includes(perfil)) {
    throw new AppError("Perfil inválido.", 400);
  }

  const perfilFinal = perfil || usuario.perfil;

  if (perfilFinal === "CAIXA") {
    const contasFinais =
      contaBancariaIds !== undefined || contaBancariaId !== undefined
        ? contasIds
        : await prisma.usuarioContaAcesso
            .findMany({
              where: { usuarioId: Number(usuarioId) },
              select: { contaBancariaId: true },
            })
            .then((items) => items.map((item) => item.contaBancariaId));

    const contasFinaisComFallback = contasFinais.length
      ? contasFinais
      : usuario.contaBancariaId
        ? [usuario.contaBancariaId]
        : [];

    if (!contasFinaisComFallback.length) {
      throw new AppError(
        "Usuários com perfil CAIXA exigem ao menos uma conta bancária.",
        400,
      );
    }
  }

  if (
    perfilFinal !== "CAIXA" &&
    (contaBancariaIds !== undefined || contaBancariaId !== undefined) &&
    contasIds.length
  ) {
    throw new AppError("Apenas usuários CAIXA podem ter conta restrita.", 400);
  }

  await ensureContasExistem(contasIds);

  const senhaHash = senha ? await bcrypt.hash(senha, 10) : undefined;

  const atualizado = await prisma.$transaction(async (tx) => {
    if (
      contaBancariaIds !== undefined ||
      contaBancariaId !== undefined ||
      perfilFinal !== "CAIXA"
    ) {
      await tx.usuarioContaAcesso.deleteMany({
        where: { usuarioId: Number(usuarioId) },
      });
    }

    const updatedUser = await tx.usuario.update({
      where: { id: Number(usuarioId) },
      data: {
        ...(nome ? { nome } : {}),
        ...(perfil ? { perfil } : {}),
        ...(ativo !== undefined ? { ativo } : {}),
        ...(senhaHash ? { senhaHash } : {}),
        ...(perfilFinal === "CAIXA"
          ? {
              contaBancariaId:
                contaBancariaIds !== undefined || contaBancariaId !== undefined
                  ? contasIds[0] || null
                  : usuario.contaBancariaId,
            }
          : { contaBancariaId: null }),
      },
    });

    if (
      perfilFinal === "CAIXA" &&
      (contaBancariaIds !== undefined || contaBancariaId !== undefined)
    ) {
      await tx.usuarioContaAcesso.createMany({
        data: contasIds.map((id) => ({
          usuarioId: updatedUser.id,
          contaBancariaId: id,
        })),
      });
    }

    return tx.usuario.findUnique({
      where: { id: updatedUser.id },
      include: {
        contaBancaria: {
          select: { id: true, banco: true, nome: true },
        },
        contasAcesso: {
          include: {
            contaBancaria: {
              select: { id: true, banco: true, nome: true },
            },
          },
          orderBy: { contaBancariaId: "asc" },
        },
      },
    });
  });

  return mapUsuarioResponse(atualizado);
}

/**
 * Deleta um usuário.
 * @param {number} usuarioId ID do usuário.
 * @returns {Promise<{id: number}>}
 */
async function deletarUsuario(usuarioId) {
  const usuario = await prisma.usuario.findUnique({
    where: { id: Number(usuarioId) },
  });

  if (!usuario) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  await prisma.usuario.delete({
    where: { id: Number(usuarioId) },
  });

  return { id: Number(usuarioId) };
}

module.exports = {
  listarUsuarios,
  criarUsuario,
  atualizarUsuario,
  deletarUsuario,
};
