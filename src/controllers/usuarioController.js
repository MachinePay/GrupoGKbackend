const usuarioService = require("../services/usuarioService");
const AppError = require("../middlewares/appError");

/**
 * Lista usuários com filtros.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function listar(req, res, next) {
  try {
    const { perfil, contaBancariaId } = req.query;

    const usuarios = await usuarioService.listarUsuarios({
      perfil,
      contaBancariaId,
    });

    res.json(usuarios);
  } catch (error) {
    next(error);
  }
}

/**
 * Cria novo usuário.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function criar(req, res, next) {
  try {
    const { nome, email, senha, perfil, contaBancariaId, contaBancariaIds } =
      req.body;

    const usuario = await usuarioService.criarUsuario({
      nome,
      email,
      senha,
      perfil,
      contaBancariaId,
      contaBancariaIds,
    });

    res.status(201).json(usuario);
  } catch (error) {
    next(error);
  }
}

/**
 * Atualiza usuário.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function atualizar(req, res, next) {
  try {
    const { id } = req.params;
    const { nome, perfil, ativo, contaBancariaId, contaBancariaIds, senha } =
      req.body;

    const usuario = await usuarioService.atualizarUsuario(id, {
      nome,
      perfil,
      ativo,
      contaBancariaId,
      contaBancariaIds,
      senha,
    });

    res.json(usuario);
  } catch (error) {
    next(error);
  }
}

/**
 * Deleta usuário.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function deletar(req, res, next) {
  try {
    const { id } = req.params;

    const resultado = await usuarioService.deletarUsuario(id);

    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listar,
  criar,
  atualizar,
  deletar,
};
